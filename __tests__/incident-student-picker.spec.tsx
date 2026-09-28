import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SchoolClass, Student } from '../types';
import { EMPTY_INCIDENT_STUDENT_FILTERS, IncidentStudentPicker } from '../components/supervision/IncidentStudentPicker';

const students: Student[] = [
  { id: 'ST-10', name: 'أَحْمَد محمد علي', class_name: 'الأول', section: 'أ' },
  { id: 'ST-2', name: 'أحمد سالم علي', class_name: 'الثاني', section: 'ب' },
  { id: 'ST-123', name: 'مُوسَى إبراهيم', class_name: 'الأول', section: 'ج' }
];
const classes: SchoolClass[] = [
  { id: 'c1', name: 'الأول', sections: ['أ', 'ج'] },
  { id: 'c2', name: 'الثاني', sections: ['ب'] }
];

function FormHarness({ rows = students, disabled = false, initialId = '' }: {
  rows?: Student[];
  disabled?: boolean;
  initialId?: string;
}) {
  const [filters, setFilters] = useState({ ...EMPTY_INCIDENT_STUDENT_FILTERS });
  const [value, setValue] = useState(initialId);
  const [reason, setReason] = useState('');
  return (
    <>
      <IncidentStudentPicker students={rows} classes={classes} value={value} onChange={setValue}
        filters={filters} onFilterChange={partial => setFilters(previous => ({ ...previous, ...partial }))}
        disabled={disabled} />
      <input aria-label="سبب التسجيل" value={reason} onChange={event => setReason(event.target.value)} />
      <output aria-label="معرف الطالب في النموذج">{value}</output>
    </>
  );
}

const search = () => screen.getByRole('searchbox', { name: 'بحث عن الطالب بالاسم أو المعرف' });
const resultIds = () => screen.queryAllByRole('radio').map(input => (input as HTMLInputElement).value);

afterEach(cleanup);

describe('incident student picker', () => {
  it('keeps search, focus, and the selected identifier through parent form updates', () => {
    const { rerender } = render(<FormHarness />);
    const input = search() as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'احمد علي' } });
    expect(document.activeElement).toBe(input);
    expect(resultIds()).toHaveLength(2);

    fireEvent.click(screen.getByRole('radio', { name: /ST-2/ }));
    fireEvent.change(screen.getByLabelText('سبب التسجيل'), { target: { value: 'موعد طبي' } });
    // New data arrays simulate a live refresh of the parent page.
    rerender(<FormHarness rows={students.map(student => ({ ...student }))} />);
    expect(search()).toBe(input);
    expect(input.value).toBe('احمد علي');
    expect(document.activeElement).toBe(input);
    expect(screen.getByLabelText('معرف الطالب في النموذج').textContent).toBe('ST-2');
    expect((screen.getByRole('radio', { name: /ST-2/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('matches Arabic variants, separated name parts, elongation, and Arabic/Persian identifiers', () => {
    render(<FormHarness />);
    fireEvent.change(search(), { target: { value: 'موسي ابـراهيم' } });
    expect(resultIds()).toEqual(['ST-123']);
    fireEvent.change(search(), { target: { value: '١۲٣' } });
    expect(resultIds()).toEqual(['ST-123']);
    fireEvent.change(search(), { target: { value: 'علي احمد' } });
    expect(resultIds()).toHaveLength(2);
  });

  it('combines class and section filters and resets the section without erasing search', () => {
    render(<FormHarness />);
    fireEvent.change(search(), { target: { value: 'احمد' } });
    fireEvent.change(screen.getByLabelText('الصف الدراسي'), { target: { value: 'الأول' } });
    fireEvent.change(screen.getByLabelText('الفصل'), { target: { value: 'أ' } });
    expect(resultIds()).toEqual(['ST-10']);
    expect(within(screen.getByLabelText('الفصل')).queryByRole('option', { name: 'ب' })).toBeNull();
    fireEvent.change(screen.getByLabelText('الصف الدراسي'), { target: { value: 'الثاني' } });
    expect((screen.getByLabelText('الفصل') as HTMLSelectElement).value).toBe('');
    expect((search() as HTMLInputElement).value).toBe('احمد');
    expect(resultIds()).toEqual(['ST-2']);
  });

  it('keeps a filtered-out selection visible and requires an explicit replacement or clear', () => {
    render(<FormHarness />);
    fireEvent.click(screen.getByRole('radio', { name: /ST-10/ }));
    fireEvent.change(screen.getByLabelText('الصف الدراسي'), { target: { value: 'الثاني' } });
    expect(screen.getByText(/الطالب المحدد خارج نتائج البحث الحالية/)).toBeTruthy();
    expect(screen.getByText('أَحْمَد محمد علي')).toBeTruthy();
    expect(screen.getByLabelText('معرف الطالب في النموذج').textContent).toBe('ST-10');
    fireEvent.click(screen.getByRole('radio', { name: /ST-2/ }));
    expect(screen.getByLabelText('معرف الطالب في النموذج').textContent).toBe('ST-2');
    expect(screen.queryByText(/الطالب المحدد خارج نتائج البحث الحالية/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء الاختيار' }));
    expect(screen.getByLabelText('معرف الطالب في النموذج').textContent).toBe('');
    expect(document.activeElement).toBe(search());
  });

  it('sorts identifiers numerically, groups by class, and puts an exact identifier first', () => {
    render(<FormHarness rows={[...students, { ...students[0], id: 'ST-20', name: 'ابراهيم' }]} />);
    fireEvent.change(screen.getByLabelText('ترتيب الطلاب'), { target: { value: 'id' } });
    expect(resultIds()).toEqual(['ST-2', 'ST-10', 'ST-20', 'ST-123']);
    fireEvent.change(screen.getByLabelText('ترتيب الطلاب'), { target: { value: 'class' } });
    expect(resultIds().at(-1)).toBe('ST-2');
    fireEvent.change(search(), { target: { value: 'ST-2' } });
    expect(resultIds()).toEqual(['ST-2', 'ST-20']);
  });

  it('paginates large rosters and resets the page when filters change', () => {
    const roster = Array.from({ length: 65 }, (_, index) => ({
      id: String(index + 1), name: `طالب ${index + 1}`, class_name: 'الأول', section: 'أ'
    }));
    render(<FormHarness rows={roster} />);
    expect(resultIds()).toHaveLength(30);
    fireEvent.click(screen.getByRole('button', { name: 'الصفحة التالية من الطلاب' }));
    expect(resultIds()[0]).toBe('31');
    fireEvent.click(screen.getByRole('radio', { name: /طالب 31 / }));
    fireEvent.change(search(), { target: { value: '65' } });
    expect(resultIds()).toEqual(['65']);
    expect(screen.getByLabelText('معرف الطالب في النموذج').textContent).toBe('31');
    fireEvent.click(screen.getByRole('button', { name: 'مسح البحث' }));
    expect(resultIds()[0]).toBe('1');
  });

  it('offers a useful empty state without changing the selected student', () => {
    render(<FormHarness initialId="ST-10" />);
    fireEvent.change(search(), { target: { value: 'غير موجود' } });
    expect(screen.getByText('لا يوجد طالب مطابق')).toBeTruthy();
    expect(resultIds()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'عرض جميع الطلاب المتاحين' }));
    expect(resultIds()).toHaveLength(3);
    expect(screen.getByLabelText('معرف الطالب في النموذج').textContent).toBe('ST-10');
  });

  it('shows the locked student independently of stale filters during editing', () => {
    const { rerender } = render(<FormHarness initialId="ST-10" />);
    fireEvent.change(search(), { target: { value: 'غير موجود' } });
    rerender(<FormHarness initialId="ST-10" disabled />);
    expect(screen.getByText('أَحْمَد محمد علي')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: 'إلغاء الاختيار' })).toBeNull();
    expect(screen.getByLabelText('معرف الطالب في النموذج').textContent).toBe('ST-10');
  });

  it('moves keyboard focus from search to the student results without auto-selecting', () => {
    render(<FormHarness />);
    search().focus();
    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getAllByRole('radio')[0]);
    expect(screen.getByLabelText('معرف الطالب في النموذج').textContent).toBe('');
    const selected = screen.getByRole('radio', { name: /ST-123/ });
    fireEvent.click(selected);
    search().focus();
    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(selected);
  });

  it('shows an empty roster and does not invent a replacement for a removed student', () => {
    const { rerender } = render(<FormHarness rows={[]} />);
    expect(screen.getByText('لا يوجد طلاب متاحون للاختيار')).toBeTruthy();
    rerender(<FormHarness initialId="ST-10" />);
    fireEvent.click(screen.getByRole('radio', { name: /ST-10/ }));
    rerender(<FormHarness rows={[]} />);
    expect(screen.getByRole('alert').textContent).toContain('الطالب المحدد غير موجود');
    expect(resultIds()).toEqual([]);
  });
});
