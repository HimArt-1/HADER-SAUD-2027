import React, { useState } from 'react';
import { ArrowRight, Mic } from 'lucide-react';
import type { Student } from '../../types';

interface GuardListSelectorProps {
  students: Student[];
  onSelect: (student: Student) => void;
  disabled?: boolean;
}

const GuardListSelector: React.FC<GuardListSelectorProps> = ({ students, onSelect, disabled }) => {
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const classes = Array.from(new Set(students.map(student => student.class_name))).sort((a, b) => a.localeCompare(b, 'ar'));
  const sections = selectedClass !== null
    ? Array.from(new Set(students.filter(student => student.class_name === selectedClass).map(student => student.section))).sort((a, b) => a.localeCompare(b, 'ar')) : [];
  const filteredStudents = selectedClass !== null && selectedSection !== null
    ? students.filter(student => student.class_name === selectedClass && student.section === selectedSection).sort((a, b) => a.name.localeCompare(b.name, 'ar-SA')) : [];

  return (
    <div className="guard-directory">
      <div className="guard-phone__screen-title">
        <h2>{selectedClass === null ? 'اختر الصف' : selectedSection === null ? 'اختر الفصل' : `${selectedClass} / ${selectedSection || 'بدون فصل'}`}</h2>
        {selectedClass !== null && <button type="button" disabled={disabled} onClick={() => selectedSection !== null ? setSelectedSection(null) : setSelectedClass(null)}><ArrowRight size={14} /> رجوع</button>}
      </div>
      <p className="guard-directory__hint">{selectedSection !== null ? 'اضغط اسم الطالب لإرسال النداء' : 'الوصول إلى الطالب من قائمة المدرسة'}</p>
      <div className="guard-directory__scroll">
        {selectedClass === null ? (
          <div className="guard-directory__grid">{classes.map(className => <button type="button" key={className} className="guard-phone__lcd-button" disabled={disabled} onClick={() => setSelectedClass(className)}>{className || 'بدون صف'}</button>)}</div>
        ) : selectedSection === null ? (
          <div className="guard-directory__grid">{sections.map(section => <button type="button" key={section} className="guard-phone__lcd-button" disabled={disabled} onClick={() => setSelectedSection(section)}>{section || 'بدون فصل'}</button>)}</div>
        ) : filteredStudents.map(student => (
          <button type="button" key={student.id} className="guard-directory__student" disabled={disabled} onClick={() => onSelect(student)}>
            <span><strong>{student.name}</strong><small dir="ltr">{student.id}</small></span><Mic size={17} aria-hidden="true" />
          </button>
        ))}
        {students.length === 0 && <p className="guard-directory__empty">لا يوجد طلاب في الدليل النشط</p>}
        {selectedSection !== null && filteredStudents.length === 0 && <p className="guard-directory__empty">لا يوجد طلاب في هذا الفصل</p>}
      </div>
    </div>
  );
};
export default GuardListSelector;
