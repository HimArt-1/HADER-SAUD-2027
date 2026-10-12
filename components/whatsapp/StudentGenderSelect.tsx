import React from 'react';

export type StudentGender = 'male' | 'female';

interface StudentGenderSelectProps {
    id: string;
    value: StudentGender;
    onChange: (gender: StudentGender) => void;
    disabled?: boolean;
}

const StudentGenderSelect: React.FC<StudentGenderSelectProps> = ({ id, value, onChange, disabled }) => (
    <div>
        <label htmlFor={id} className="mb-2 block text-xs font-bold text-slate-500">صيغة المخاطبة</label>
        <select id={id} value={value} disabled={disabled}
            onChange={event => onChange(event.target.value === 'female' ? 'female' : 'male')}
            className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm text-slate-800 focus:ring-2 focus:ring-emerald-500 disabled:opacity-50">
            <option value="male">طالب</option>
            <option value="female">طالبة</option>
        </select>
    </div>
);

export default StudentGenderSelect;
