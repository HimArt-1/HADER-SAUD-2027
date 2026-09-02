import React from 'react';
import { MappingConfig, MappingTarget, MappingConfidence } from '../../types/import';

const targetLabels: Record<MappingTarget, string> = {
  id: 'المعرف (ID)',
  name: 'اسم الطالب',
  gradeLevel: 'الصف',
  sectionName: 'الفصل',
  guardianPhone: 'رقم ولي الأمر'
};

const confidenceLabels: Record<MappingConfidence, { label: string; className: string }> = {
  High: { label: 'ثقة عالية', className: 'text-emerald-400' },
  Medium: { label: 'ثقة متوسطة', className: 'text-amber-400' },
  Low: { label: 'ثقة منخفضة', className: 'text-red-400' }
};

type Props = {
  columns: string[];
  mapping: MappingConfig;
  confidence: Record<MappingTarget, MappingConfidence>;
  warnings: string[];
  ambiguous: boolean;
  onChange: (next: MappingConfig) => void;
  onSwap: () => void;
};

export const ColumnMapper: React.FC<Props> = ({
  columns,
  mapping,
  confidence,
  warnings,
  ambiguous,
  onChange,
  onSwap
}) => {
  const options = ['']
    .concat(columns)
    .map(value => ({ value, label: value || '— لا يوجد —' }));

  const handleSelect = (target: MappingTarget, value: string) => {
    onChange({
      ...mapping,
      [target]: value || null
    });
  };

  const handleDefault = (target: 'gradeLevel' | 'sectionName', value: string) => {
    onChange({
      ...mapping,
      defaults: {
        ...mapping.defaults,
        [target]: value
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-white">مطابقة الأعمدة</h3>
          <p className="text-xs text-gray-400">تأكد من مطابقة الأعمدة للحقول المطلوبة.</p>
        </div>
        <button
          type="button"
          onClick={onSwap}
          className="px-4 py-2 text-xs font-bold rounded-xl border border-primary-500/40 text-primary-300 hover:bg-primary-500/10 transition"
        >
          تبديل الصف ↔ الفصل
        </button>
      </div>

      {ambiguous && (
        <div className="p-3 rounded-xl border border-amber-400/30 bg-amber-500/10 text-amber-200 text-xs">
          ⚠️ أعمدة الصف/الفصل غير واضحة. يرجى التأكد يدوياً من المطابقة.
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((warning, index) => (
            <div key={index} className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              {warning}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(['id', 'name', 'gradeLevel', 'sectionName', 'guardianPhone'] as MappingTarget[]).map(target => (
          <div key={target} className="p-4 rounded-2xl border border-white/10 bg-white/5">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-white">{targetLabels[target]}</label>
              <span className={`text-[10px] font-semibold ${confidenceLabels[confidence[target]].className}`}>
                {confidenceLabels[confidence[target]].label}
              </span>
            </div>
            <select
              className="w-full input-glass p-2 rounded-xl text-sm"
              value={mapping[target] || ''}
              onChange={(event) => handleSelect(target, event.target.value)}
            >
              {options.map(option => (
                <option key={`${target}-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {(target === 'gradeLevel' || target === 'sectionName') && (
              <div className="mt-2">
                <label className="text-[11px] text-gray-400">قيمة افتراضية (عند عدم توفر العمود)</label>
                <input
                  className="mt-1 w-full input-glass p-2 rounded-xl text-xs"
                  value={mapping.defaults?.[target] || ''}
                  onChange={(event) => handleDefault(target, event.target.value)}
                  placeholder={target === 'gradeLevel' ? 'مثال: أول' : 'مثال: أ'}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
