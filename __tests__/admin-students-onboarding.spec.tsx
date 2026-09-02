import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AdminStudentsTab, { AdminStudentsTabProps } from '../components/admin/AdminStudentsTab';

const createEmptyProps = (overrides: Partial<AdminStudentsTabProps> = {}) => ({
  students: [],
  sortedStudents: [],
  filteredStudents: [],
  selectedStudentIds: new Set<string>(),
  statusCounts: { active: 0, inactive: 0 },
  hasSchoolStructure: false,
  onGoToStructure: vi.fn(),
  handleExportTemplate: vi.fn(),
  openPrivacyGate: vi.fn(),
  ...overrides
} as unknown as AdminStudentsTabProps);

describe('student onboarding', () => {
  it('guides an empty school to create its structure without showing advanced management tools', () => {
    const onGoToStructure = vi.fn();

    render(<AdminStudentsTab {...createEmptyProps({ onGoToStructure })} />);

    expect(screen.getByText('أنشئ الهيكل أولًا، أو استورد القائمة مباشرة')).toBeTruthy();
    expect(screen.queryByText('الفلاتر الذكية')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /إنشاء الصفوف والفصول/ }));
    expect(onGoToStructure).toHaveBeenCalledTimes(1);
  });

  it('opens the add-student flow when the structure is ready', () => {
    const openPrivacyGate = vi.fn();

    render(
      <AdminStudentsTab
        {...createEmptyProps({
          hasSchoolStructure: true,
          openPrivacyGate
        })}
      />
    );

    expect(screen.getByText('أضف أول طالب إلى السجل')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /إضافة أول طالب/ })[0]);
    expect(openPrivacyGate).toHaveBeenCalledWith('add');
  });
});
