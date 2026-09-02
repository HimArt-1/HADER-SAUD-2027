
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Student, SchoolClass } from '../types';
import { Search, Check, User, Filter } from 'lucide-react';

// Helper functions
const normalizeLabel = (value?: string | null) =>
  (value ?? '').toString().trim().replace(/\s+/g, ' ').toLowerCase();

const formatLabel = (value?: string | null) => (value ?? '').toString().trim();

const collectUniqueLabels = (values: Array<string | null | undefined>) => {
  const map = new Map<string, string>();
  values.forEach(value => {
    const formatted = formatLabel(value);
    const norm = normalizeLabel(formatted);
    if (norm && !map.has(norm)) {
      map.set(norm, formatted);
    }
  });

  return Array.from(map.values()).sort((a, b) =>
    a.localeCompare(b, 'ar', { numeric: true, sensitivity: 'base' })
  );
};

const compareLabels = (a: string, b: string) =>
  a.localeCompare(b, 'ar', { numeric: true, sensitivity: 'base' });

const labelsMatch = (a?: string | null, b?: string | null) =>
  normalizeLabel(a) === normalizeLabel(b);

export interface StudentSelectFilters {
  class_name: string;
  section: string;
  search: string;
}

interface StudentSelectComponentProps {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  students: Student[];
  classes: SchoolClass[];
  filters: StudentSelectFilters;
  onFilterChange: (filters: Partial<StudentSelectFilters>) => void;
  onSelect?: (id: string) => void;
  selectedId?: string;
}

export const StudentSelectComponent: React.FC<StudentSelectComponentProps> = React.memo(({
  value,
  onChange,
  onSelect,
  label = 'الطالب *',
  students,
  classes,
  filters,
  onFilterChange
}) => {
  // Local state for search input to prevent cursor jumping
  const [searchText, setSearchText] = useState(filters.search);

  // Sync local search text when external filters change
  useEffect(() => {
    if (filters.search !== searchText) {
      setSearchText(filters.search);
    }
  }, [filters.search]);

  // Debounce filter update for search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchText !== filters.search) {
        onFilterChange({ search: searchText });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText, filters.search, onFilterChange]);

  const uniqueClasses = useMemo(
    () => collectUniqueLabels([...students.map(s => s.class_name), ...classes.map(c => c.name)]),
    [students, classes]
  );

  const getSectionsForClass = (className?: string) => {
    const normClass = normalizeLabel(className);
    const hasClass = Boolean(normClass);
    const sources: Array<string | null | undefined> = [];

    students.forEach(student => {
      if (!hasClass || normalizeLabel(student.class_name) === normClass) {
        sources.push(student.section);
      }
    });

    if (hasClass) {
      const classMatch = classes.find(c => normalizeLabel(c.name) === normClass);
      if (classMatch?.sections?.length) {
        sources.push(...classMatch.sections);
      }
    } else {
      classes.forEach(cls => sources.push(...(cls.sections || [])));
    }

    return collectUniqueLabels(sources);
  };

  const availableSections = useMemo(
    () => getSectionsForClass(filters.class_name || undefined),
    [filters.class_name, students, classes]
  );

  const filteredStudents = useMemo(() => {
    let list = [...students];
    if (filters.class_name) {
      list = list.filter(student => labelsMatch(student.class_name, filters.class_name));
    }
    if (filters.section) {
      list = list.filter(student => labelsMatch(student.section, filters.section));
    }

    const query = searchText.trim().toLowerCase();
    if (query) {
      list = list.filter(s =>
        s.name.toLowerCase().includes(query) ||
        s.id.toLowerCase().includes(query)
      );
    }
    return list.sort((a, b) => compareLabels(a.name || '', b.name || ''));
  }, [students, filters.class_name, filters.section, searchText]);

  const actualValue = value || (onSelect ? '' : value); // Handle different prop patterns if any

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-300">{label}</label>

      <div className="grid grid-cols-2 gap-2">
        <select
          value={filters.class_name}
          onChange={e => onFilterChange({ class_name: formatLabel(e.target.value), section: '' })}
          className="input-glass p-2 rounded-xl text-sm"
        >
          <option value="">كل الصفوف</option>
          {uniqueClasses.map(cls => (
            <option key={cls} value={cls}>{cls}</option>
          ))}
        </select>

        <select
          value={filters.section}
          onChange={e => onFilterChange({ section: formatLabel(e.target.value) })}
          className="input-glass p-2 rounded-xl text-sm"
          disabled={!filters.class_name}
        >
          <option value="">كل الفصول</option>
          {availableSections.map(section => (
            <option key={section} value={section}>{section}</option>
          ))}
        </select>
      </div>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          placeholder="بحث بالاسم أو المعرف..."
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          className="w-full input-glass pr-10 p-2.5 rounded-xl text-sm"
        />
      </div>

      <select
        value={actualValue}
        onChange={e => onChange(e.target.value)}
        className="w-full input-glass p-3 rounded-xl"
        size={6}
      >
        <option value="">اختر الطالب...</option>
        {filteredStudents.map(s => (
          <option key={s.id} value={s.id}>
            {s.name} | {s.id} | {s.class_name}/{s.section}
          </option>
        ))}
      </select>

      <p className="text-xs text-gray-500">{filteredStudents.length} طالب</p>
    </div>
  );
});

// --- IMPROVED MULTI SELECT COMPONENT ---
interface MultiStudentSelectComponentProps {
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  students: Student[];
  classes: SchoolClass[];
  filters: StudentSelectFilters;
  onFilterChange: (filters: Partial<StudentSelectFilters>) => void;
}

export const MultiStudentSelectComponent: React.FC<MultiStudentSelectComponentProps> = React.memo(({
  value,
  onChange,
  label = 'الطلاب (يمكن اختيار متعدد) *',
  students,
  classes,
  filters,
  onFilterChange
}) => {
  // Re-use logic for filtering
  const [searchText, setSearchText] = useState(filters.search);
  useEffect(() => {
    if (filters.search !== searchText) setSearchText(filters.search);
  }, [filters.search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchText !== filters.search) onFilterChange({ search: searchText });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText, filters.search, onFilterChange]);

  const uniqueClasses = useMemo(() =>
    collectUniqueLabels([...students.map(s => s.class_name), ...classes.map(c => c.name)]),
    [students, classes]);

  const getSectionsForClass = (className?: string) => {
    const normClass = normalizeLabel(className);
    const hasClass = Boolean(normClass);
    const sources: Array<string | null | undefined> = [];
    students.forEach(student => {
      if (!hasClass || normalizeLabel(student.class_name) === normClass) sources.push(student.section);
    });
    if (hasClass) {
      const classMatch = classes.find(c => normalizeLabel(c.name) === normClass);
      if (classMatch?.sections?.length) sources.push(...classMatch.sections);
    } else {
      classes.forEach(cls => sources.push(...(cls.sections || [])));
    }
    return collectUniqueLabels(sources);
  };

  const availableSections = useMemo(() =>
    getSectionsForClass(filters.class_name || undefined),
    [filters.class_name, students, classes]);

  const filteredStudents = useMemo(() => {
    let list = [...students];
    if (filters.class_name) list = list.filter(student => labelsMatch(student.class_name, filters.class_name));
    if (filters.section) list = list.filter(student => labelsMatch(student.section, filters.section));
    const query = searchText.trim().toLowerCase();
    if (query) {
      list = list.filter(s => s.name.toLowerCase().includes(query) || s.id.toLowerCase().includes(query));
    }
    return list.sort((a, b) => compareLabels(a.name || '', b.name || ''));
  }, [students, filters.class_name, filters.section, searchText]);

  const toggleSelection = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter(v => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const toggleAll = () => {
    if (value.length === filteredStudents.length && filteredStudents.length > 0) {
      onChange([]);
    } else {
      onChange(filteredStudents.map(s => s.id));
    }
  };

  return (
    <div className="space-y-3 h-full flex flex-col">
      <div className="flex justify-between items-end">
        <label className="text-sm font-medium text-gray-300">{label}</label>
        <div className="text-xs text-secondary-400">
          تم تحديد {value.length} من {filteredStudents.length}
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 gap-2">
        <select
          value={filters.class_name}
          onChange={e => onFilterChange({ class_name: formatLabel(e.target.value), section: '' })}
          className="input-glass p-2 rounded-xl text-xs"
        >
          <option value="">كل الصفوف</option>
          {uniqueClasses.map(cls => <option key={cls} value={cls}>{cls}</option>)}
        </select>

        <select
          value={filters.section}
          onChange={e => onFilterChange({ section: formatLabel(e.target.value) })}
          className="input-glass p-2 rounded-xl text-xs"
          disabled={!filters.class_name}
        >
          <option value="">كل الفصول</option>
          {availableSections.map(section => <option key={section} value={section}>{section}</option>)}
        </select>
      </div>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          placeholder="بحث..."
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          className="w-full input-glass pr-10 p-2 rounded-xl text-sm"
        />
      </div>

      {/* Custom List UI */}
      <div className="flex-1 bg-black/20 rounded-xl border border-white/5 overflow-hidden flex flex-col min-h-[300px]">
        {/* Select All Header */}
        <div
          onClick={toggleAll}
          className="p-3 border-b border-white/5 flex items-center gap-3 cursor-pointer hover:bg-white/5 transition-colors"
        >
          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${value.length === filteredStudents.length && filteredStudents.length > 0 ? 'bg-secondary-500 border-secondary-500' : 'border-gray-500'}`}>
            {value.length === filteredStudents.length && filteredStudents.length > 0 && <Check className="w-3 h-3 text-white" />}
          </div>
          <span className="text-sm font-bold text-gray-300">تحديد الكل</span>
        </div>

        <div className="overflow-y-auto flex-1 p-2 space-y-1 custom-scrollbar">
          {filteredStudents.map(s => {
            const isSelected = value.includes(s.id);
            return (
              <div
                key={s.id}
                onClick={() => toggleSelection(s.id)}
                className={`p-2 rounded-lg flex items-center gap-3 cursor-pointer border transition-all ${isSelected ? 'bg-secondary-500/10 border-secondary-500/30' : 'hover:bg-white/5 border-transparent'}`}
              >
                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-secondary-500 border-secondary-500' : 'border-gray-600'}`}>
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm font-medium truncate ${isSelected ? 'text-secondary-100' : 'text-gray-300'}`}>{s.name}</p>
                    <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded text-gray-400 whitespace-nowrap">{s.class_name} - {s.section}</span>
                  </div>
                  <p className="text-[10px] text-gray-500 truncate">{s.id}</p>
                </div>
              </div>
            );
          })}

          {filteredStudents.length === 0 && (
            <div className="p-8 text-center text-gray-500 flex flex-col items-center">
              <Filter className="w-8 h-8 mb-2 opacity-20" />
              <span className="text-sm">لا توجد نتائج</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
