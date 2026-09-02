import React, { useState, useEffect } from 'react';
import { Student } from '../../types';

interface GuardListSelectorProps {
  students: Student[];
  onSelect: (student: Student) => void;
  disabled?: boolean;
}

const GuardListSelector: React.FC<GuardListSelectorProps> = ({ students, onSelect, disabled }) => {
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  const classes = Array.from(new Set(students.map(s => s.class_name))).sort();
  
  const sections = selectedClass 
    ? Array.from(new Set(students.filter(s => s.class_name === selectedClass).map(s => s.section))).sort()
    : [];

  const filteredStudents = (selectedClass && selectedSection)
    ? students.filter(s => s.class_name === selectedClass && s.section === selectedSection).sort((a,b) => a.name.localeCompare(b.name, 'ar-SA'))
    : [];

  return (
    <div className="flex flex-col h-full bg-[#111] p-4 text-white">
      {/* Class Selection */}
      {!selectedClass && (
        <div className="animate-fade-in-up">
          <h2 className="text-xl font-bold font-serif mb-4 text-amber-400 border-b border-amber-500/30 pb-2">اختر الصف</h2>
          <div className="grid grid-cols-2 gap-3">
            {classes.map(cls => (
              <button
                key={cls}
                onClick={() => setSelectedClass(cls)}
                disabled={disabled}
                className="bg-amber-500/10 hover:bg-amber-500/20 active:bg-amber-500/30 border border-amber-500/30 rounded-2xl p-4 text-lg font-bold shadow-[0_0_15px_rgba(245,158,11,0.1)] transition-all"
              >
                {cls}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Section Selection */}
      {selectedClass && !selectedSection && (
        <div className="animate-fade-in-up">
          <div className="flex justify-between items-center mb-4 border-b border-amber-500/30 pb-2">
            <h2 className="text-xl font-bold font-serif text-amber-400">اختر الفصل</h2>
            <button onClick={() => setSelectedClass(null)} className="text-sm bg-white/10 px-3 py-1 rounded-full text-gray-300">رجوع</button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {sections.map(sec => (
              <button
                key={sec}
                onClick={() => setSelectedSection(sec)}
                disabled={disabled}
                className="bg-secondary-500/10 hover:bg-secondary-500/20 active:bg-secondary-500/30 border border-secondary-500/30 rounded-2xl p-4 text-xl font-bold shadow-[0_0_15px_rgb(var(--color-secondary-500)_/_0.1)] transition-all"
              >
                {sec}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Student List */}
      {selectedClass && selectedSection && (
        <div className="flex flex-col h-full animate-fade-in-up">
          <div className="flex justify-between items-center mb-4 border-b border-emerald-500/30 pb-2 shrink-0">
            <h2 className="text-xl font-bold font-serif text-emerald-400">{selectedClass} - {selectedSection}</h2>
            <button onClick={() => setSelectedSection(null)} className="text-sm bg-white/10 px-3 py-1 rounded-full text-gray-300">رجوع</button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 pb-20">
            {filteredStudents.map(student => (
              <button
                key={student.id}
                onClick={() => onSelect(student)}
                disabled={disabled}
                className="w-full text-right p-4 rounded-xl font-bold text-lg bg-emerald-500/10 border border-emerald-500/30 active:bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.1)] transition-all flex justify-between items-center group"
              >
                <span>{student.name}</span>
                <span className="text-xs font-mono text-emerald-400 group-active:text-white opacity-60 bg-black/40 px-2 py-1 rounded-md">{student.id}</span>
              </button>
            ))}
            {filteredStudents.length === 0 && (
              <div className="text-center p-8 text-gray-500">لا يوجد طلاب في هذا الفصل</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default GuardListSelector;
