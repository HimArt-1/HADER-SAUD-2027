import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AdminDashboard from '../components/admin/AdminDashboard';

describe('admin dashboard empty state', () => {
  it('guides a new school to structure and student management', () => {
    const setActiveTab = vi.fn();

    render(
      <AdminDashboard
        stats={{
          total_students: 0,
          present_count: 0,
          late_count: 0,
          absent_count: 0,
          attendance_rate: 0
        }}
        detailedStats={{
          rateChange: 0,
          comparisonRate: 0,
          comparisonLabel: 'الخميس، 20 أغسطس',
          averageWeeklyRate: 0,
          isTodayHoliday: false
        }}
        weeklyStats={[]}
        classStats={[]}
        monthlyTrends={[]}
        violationsData={[]}
        exitsData={[]}
        setActiveTab={setActiveTab}
      />
    );

    expect(screen.getByText('جهّز الهيكل المدرسي لتبدأ لوحة القيادة بالعمل')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'إعداد الصفوف والفصول' }));
    expect(setActiveTab).toHaveBeenCalledWith('structure');

    fireEvent.click(screen.getByRole('button', { name: 'إدارة الطلاب' }));
    expect(setActiveTab).toHaveBeenCalledWith('students');
  });
});
