import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Search, SlidersHorizontal, UserCheck, Users, X } from 'lucide-react';
import type { SchoolClass, Student } from '../../types';
import { normalizeStudentSearchText } from './supervisionStudentDirectory';

export type IncidentStudentFilters = {
  class_name: string;
  section: string;
  search: string;
  sort: 'name' | 'class' | 'id';
};

export const EMPTY_INCIDENT_STUDENT_FILTERS: IncidentStudentFilters = {
  class_name: '', section: '', search: '', sort: 'name'
};

interface IncidentStudentPickerProps {
  students: Student[];
  classes: SchoolClass[];
  value: string;
  onChange: (id: string) => void;
  filters: IncidentStudentFilters;
  onFilterChange: (filters: Partial<IncidentStudentFilters>) => void;
  disabled?: boolean;
}

const PAGE_SIZE = 30;
const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });
const labelKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const searchKey = (value: string) => normalizeStudentSearchText(value).replace(/ـ/g, '');
const uniqueLabels = (values: string[]) => {
  const labels = new Map<string, string>();
  values.forEach(value => {
    const key = labelKey(value);
    if (key && !labels.has(key)) labels.set(key, value.trim());
  });
  return [...labels.values()].sort(collator.compare);
};

const StudentDetails = ({ student }: { student: Student }) => (
  <span className="block min-w-0 flex-1">
    <span className="block break-words text-sm font-semibold leading-6 text-slate-100">{student.name}</span>
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-slate-400">
      <span>{student.class_name || 'صف غير محدد'}{student.section ? ` · فصل ${student.section}` : ''}</span>
      <span className="text-slate-600" aria-hidden="true">/</span>
      <span className="min-w-0 break-all">المعرف <bdi className="font-mono tabular-nums">{student.id}</bdi></span>
    </span>
  </span>
);

/** Kept outside Supervision so form edits and live updates preserve focus and search. */
export const IncidentStudentPicker = React.memo(function IncidentStudentPicker({
  students, classes, value, onChange, filters, onFilterChange, disabled = false
}: IncidentStudentPickerProps) {
  const id = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [pagination, setPagination] = useState({ criteria: '', page: 0 });
  const criteria = JSON.stringify(filters);
  const selectedStudent = students.find(student => student.id === value);
  const hasFilters = Boolean(filters.search || filters.class_name || filters.section);

  useEffect(() => {
    setPagination({ criteria, page: 0 });
    resultsRef.current?.scrollTo?.({ top: 0 });
  }, [criteria]);

  const classOptions = useMemo(() => uniqueLabels([
    ...students.map(student => student.class_name), ...classes.map(schoolClass => schoolClass.name)
  ]), [students, classes]);

  const sectionOptions = useMemo(() => uniqueLabels([
    ...students.filter(student => !filters.class_name || labelKey(student.class_name) === labelKey(filters.class_name))
      .map(student => student.section),
    ...classes.filter(schoolClass => !filters.class_name || labelKey(schoolClass.name) === labelKey(filters.class_name))
      .flatMap(schoolClass => schoolClass.sections || [])
  ]), [students, classes, filters.class_name]);

  const searchIndex = useMemo(() => students.map(student => ({
    student,
    name: searchKey(student.name),
    id: searchKey(student.id),
    className: labelKey(student.class_name),
    section: labelKey(student.section)
  })), [students]);

  const filteredStudents = useMemo(() => {
    const query = searchKey(filters.search).trim();
    const tokens = query.split(/\s+/).filter(Boolean);
    return searchIndex.filter(entry =>
      (!filters.class_name || entry.className === labelKey(filters.class_name)) &&
      (!filters.section || entry.section === labelKey(filters.section)) &&
      tokens.every(token => entry.name.includes(token) || entry.id.includes(token))
    ).sort((left, right) => {
      // An exact identifier is the clearest match, even among similar names.
      if (query) {
        const exactMatch = Number(right.id === query) - Number(left.id === query);
        if (exactMatch) return exactMatch;
      }
      if (filters.sort === 'class') {
        const byClass = collator.compare(left.className, right.className) || collator.compare(left.section, right.section);
        if (byClass) return byClass;
      }
      if (filters.sort === 'id') {
        const byId = collator.compare(left.id, right.id);
        if (byId) return byId;
      }
      return collator.compare(left.name, right.name) || collator.compare(left.id, right.id);
    }).map(entry => entry.student);
  }, [searchIndex, filters]);

  const pageCount = Math.max(1, Math.ceil(filteredStudents.length / PAGE_SIZE));
  const page = Math.min(pagination.criteria === criteria ? pagination.page : 0, pageCount - 1);
  const pageStudents = filteredStudents.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const selectedOutsideFilters = selectedStudent && !filteredStudents.some(student => student.id === value);
  const resetFilters = () => {
    onFilterChange({ class_name: '', section: '', search: '' });
    searchRef.current?.focus();
  };
  const changePage = (nextPage: number) => {
    setPagination({ criteria, page: nextPage });
    resultsRef.current?.scrollTo?.({ top: 0 });
  };

  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-3" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <h4 id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Users className="h-4 w-4 text-secondary-400" aria-hidden="true" />
          اختيار الطالب <span className="text-slate-500">*</span>
        </h4>
        {hasFilters && !disabled && (
          <button type="button" onClick={resetFilters} className="rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary-400">
            مسح الفلاتر
          </button>
        )}
      </div>

      {selectedStudent ? (
        <div className="rounded-xl border border-secondary-400/30 bg-secondary-500/10 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-secondary-200">
              <UserCheck className="h-4 w-4" aria-hidden="true" /> الطالب المحدد
            </span>
            {!disabled && (
              <button type="button" onClick={() => { onChange(''); searchRef.current?.focus(); }}
                className="rounded-lg px-2 py-1 text-xs text-slate-300 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary-400">
                إلغاء الاختيار
              </button>
            )}
          </div>
          <div role="status"><StudentDetails student={selectedStudent} /></div>
          {selectedOutsideFilters && !disabled && (
            <p className="mt-2 text-xs leading-5 text-amber-200">الطالب المحدد خارج نتائج البحث الحالية. يبقى مختارًا حتى تغييره أو إلغاء اختياره.</p>
          )}
        </div>
      ) : value ? (
        <p role="alert" className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-200">الطالب المحدد غير موجود في القائمة المتاحة. اختر طالبًا من النتائج.</p>
      ) : (
        <p className="text-xs leading-5 text-slate-400">ابحث عن الطالب أو حدّد صفه وفصله، ثم اختر اسمه من النتائج.</p>
      )}

      {disabled ? (
        <p className="text-xs leading-5 text-slate-400">اختيار الطالب مقفل أثناء تعديل السجل أو حفظه.</p>
      ) : (
        <>
          <div className="relative">
            <label htmlFor={`${id}-search`} className="sr-only">بحث عن الطالب بالاسم أو المعرف</label>
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <input id={`${id}-search`} ref={searchRef} type="search" autoComplete="off" value={filters.search}
              placeholder="ابحث بالاسم أو المعرف…"
              aria-describedby={`${id}-count`}
              onChange={event => onFilterChange({ search: event.target.value })}
              onKeyDown={event => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  const result = resultsRef.current?.querySelector<HTMLInputElement>('input:checked')
                    || resultsRef.current?.querySelector<HTMLInputElement>('input');
                  result?.focus();
                }
                if (event.key === 'Enter') event.preventDefault();
              }}
              className="input-glass w-full min-w-0 rounded-xl py-3 pl-10 pr-10 text-sm [&::-webkit-search-cancel-button]:appearance-none" />
            {filters.search && (
              <button type="button" aria-label="مسح البحث" onClick={() => { onFilterChange({ search: '' }); searchRef.current?.focus(); }}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary-400">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0">
              <label htmlFor={`${id}-class`} className="mb-1.5 block text-xs text-slate-400">الصف الدراسي</label>
              <select id={`${id}-class`} value={filters.class_name}
                onChange={event => onFilterChange({ class_name: event.target.value, section: '' })}
                className="input-glass w-full min-w-0 rounded-lg p-2.5 text-sm">
                <option value="">كل الصفوف</option>
                {classOptions.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor={`${id}-section`} className="mb-1.5 block text-xs text-slate-400">الفصل</label>
              <select id={`${id}-section`} value={filters.section}
                onChange={event => onFilterChange({ section: event.target.value })}
                className="input-glass w-full min-w-0 rounded-lg p-2.5 text-sm">
                <option value="">كل الفصول</option>
                {sectionOptions.map(section => <option key={section} value={section}>{section}</option>)}
              </select>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-white/10 bg-black/10">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
              <p id={`${id}-count`} role="status" className="text-xs tabular-nums text-slate-400">
                <span className="font-semibold text-slate-200">{filteredStudents.length}</span> من {students.length} طالب
              </p>
              <div className="flex items-center gap-1">
                <label htmlFor={`${id}-sort`} className="text-slate-500">
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">ترتيب الطلاب</span>
                </label>
                <select id={`${id}-sort`} value={filters.sort}
                  onChange={event => onFilterChange({ sort: event.target.value as IncidentStudentFilters['sort'] })}
                  className="input-glass max-w-full rounded-lg p-1.5 text-xs">
                  <option value="name">الاسم أبجديًا</option>
                  <option value="class">الصف ثم الفصل</option>
                  <option value="id">المعرف</option>
                </select>
              </div>
            </div>

            <div ref={resultsRef} role="radiogroup" aria-label="نتائج بحث الطلاب" aria-required="true"
              className="custom-scrollbar max-h-64 min-h-40 overflow-y-auto overscroll-contain p-1.5">
              {pageStudents.map(student => (
                <label key={student.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-inset focus-within:ring-secondary-400 ${value === student.id ? 'border-secondary-400/30 bg-secondary-500/10' : 'border-transparent hover:bg-white/5'}`}>
                  <input type="radio" name={`${id}-student`} value={student.id} checked={value === student.id}
                    onChange={() => onChange(student.id)} className="mt-1 h-4 w-4 shrink-0 accent-secondary-500" />
                  <StudentDetails student={student} />
                  {value === student.id && <Check className="mt-1 h-4 w-4 shrink-0 text-secondary-400" aria-hidden="true" />}
                </label>
              ))}
              {pageStudents.length === 0 && (
                <div className="flex min-h-40 flex-col items-center justify-center px-4 py-5 text-center">
                  <Search className="mb-3 h-6 w-6 text-slate-600" aria-hidden="true" />
                  <p className="text-sm font-medium text-slate-300">{students.length ? 'لا يوجد طالب مطابق' : 'لا يوجد طلاب متاحون للاختيار'}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{students.length ? 'جرّب جزءًا من الاسم أو المعرف، أو وسّع التصفية.' : 'ستظهر هنا أسماء الطلاب المتاحين ضمن صلاحياتك.'}</p>
                  {hasFilters && <button type="button" onClick={resetFilters} className="mt-3 rounded-lg px-3 py-2 text-xs text-secondary-200 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary-400">عرض جميع الطلاب المتاحين</button>}
                </div>
              )}
            </div>

            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-2 border-t border-white/10 p-2">
                <button type="button" aria-label="الصفحة السابقة من الطلاب" disabled={page === 0} onClick={() => changePage(page - 1)}
                  className="rounded-lg p-2 text-slate-300 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary-400 disabled:cursor-not-allowed disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
                <span className="text-xs tabular-nums text-slate-400">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredStudents.length)} من {filteredStudents.length}</span>
                <button type="button" aria-label="الصفحة التالية من الطلاب" disabled={page === pageCount - 1} onClick={() => changePage(page + 1)}
                  className="rounded-lg p-2 text-slate-300 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary-400 disabled:cursor-not-allowed disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
});
