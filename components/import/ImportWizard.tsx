import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../../services/db';
import { ImportIdMode, ImportIdPattern } from '../../services/fileService';
import { deriveStudentIdPolicy, validateStudentId, validateStudentIdForImport } from '../../services/studentIdPolicy';
import { autoMapColumns } from '../../services/import/autoMap';
import { normalizeParsedData } from '../../services/import';
import { ColumnMapper } from './ColumnMapper';
import { PreviewTable } from './PreviewTable';
import { CanonicalStudent, MappingConfig, MappingSuggestion, ParsedData } from '../../types/import';

const steps = ['اختيار الملف', 'مطابقة الأعمدة', 'معاينة وتحقق', 'ملخص الاستيراد'];

type ImportWizardProps = {
  onClose: () => void;
  onImported?: (students: CanonicalStudent[]) => void;
};

type ImportFormat = 'csv' | 'xlsx' | 'json';

const detectFormat = (file: File): ImportFormat | null => {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return 'csv';
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'xlsx';
  if (name.endsWith('.json')) return 'json';
  return null;
};

const downloadJson = (data: unknown, filename: string) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const ImportWizard: React.FC<ImportWizardProps> = ({ onClose, onImported }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [mappingSuggestion, setMappingSuggestion] = useState<MappingSuggestion | null>(null);
  const [mapping, setMapping] = useState<MappingConfig>({});
  const [importReport, setImportReport] = useState<ReturnType<typeof normalizeParsedData> | null>(null);
  const [importIdMode, setImportIdMode] = useState<ImportIdMode>('keep');
  const [importIdPattern, setImportIdPattern] = useState<ImportIdPattern>({ prefix: '', length: 6, charset: 'numeric', start: 1 });
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [studentIdPolicy, setStudentIdPolicy] = useState(() => deriveStudentIdPolicy([], { allow_edit: true }));

  const previewRows = useMemo(() => (parsedData?.rows || []).slice(0, 10), [parsedData]);

  useEffect(() => {
    let mounted = true;
    db.getSettings()
      .then((settings) => {
        if (!mounted) return;
        const incoming = settings?.security_settings?.student_id_settings;
        setStudentIdPolicy(deriveStudentIdPolicy([], incoming || {}));
      })
      .catch(() => {
        if (!mounted) return;
        setStudentIdPolicy(deriveStudentIdPolicy([], { allow_edit: true }));
      });
    return () => {
      mounted = false;
    };
  }, []);

  const parseFile = async (targetFile: File, format: ImportFormat) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const parsed = format === 'csv'
        ? await (await import('../../services/import/parsers/csv')).parseCsvFile(targetFile)
        : format === 'xlsx'
          ? await (await import('../../services/import/parsers/xlsx')).parseXlsxFile(targetFile)
          : await (await import('../../services/import/parsers/json')).parseJsonFile(targetFile);

      const suggestion = autoMapColumns(parsed.columns, parsed.rows);
      setParsedData(parsed);
      setMappingSuggestion(suggestion);
      setMapping(suggestion.mapping);
      setStepIndex(1);
    } catch (error) {
      setErrorMessage('تعذر قراءة الملف. تأكد من صحة التنسيق.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = async (nextFile: File | null) => {
    if (!nextFile) return;
    const format = detectFormat(nextFile);
    if (!format) {
      setErrorMessage('الصيغة غير مدعومة. الصيغ المتاحة: CSV / XLSX / JSON.');
      setParsedData(null);
      setMappingSuggestion(null);
      setMapping({});
      setStepIndex(0);
      return;
    }
    await parseFile(nextFile, format);
  };

  const canProceedMapping = useMemo(() => {
    if (!mapping.id || !mapping.name) return false;
    const hasGrade = Boolean(mapping.gradeLevel || mapping.defaults?.gradeLevel);
    const hasSection = Boolean(mapping.sectionName || mapping.defaults?.sectionName);
    return hasGrade && hasSection;
  }, [mapping]);

  const buildGeneratedId = (index: number, pattern?: ImportIdPattern) => {
    const length = pattern?.length && pattern.length > 0 ? pattern.length : 6;
    const start = typeof pattern?.start === 'number' && pattern.start > 0 ? pattern.start : 1;
    const charset = pattern?.charset === 'alphanumeric' ? 'alphanumeric' : 'numeric';
    const prefix = pattern?.prefix || '';

    const sequence = start + index;
    const body = charset === 'numeric'
      ? sequence.toString().padStart(length, '0')
      : sequence.toString(36).padStart(length, '0');

    return `${prefix || ''}${body}`;
  };

  const previewGeneratedIds = useMemo(
    () => Array.from({ length: 10 }, (_, idx) => buildGeneratedId(idx, importIdPattern)),
    [importIdPattern]
  );

  // Analyze imported IDs to detect format
  const importedIdAnalysis = useMemo(() => {
    if (!importReport || importIdMode !== 'keep') return null;

    const ids = importReport.students.map(s => (s.id || '').trim()).filter(Boolean);
    if (ids.length === 0) return null;

    const hasLetters = ids.some(id => /[A-Za-z]/.test(id));
    const hasNumbers = ids.some(id => /[0-9]/.test(id));
    const hasSpecialChars = ids.some(id => /[._-]/.test(id));
    const allNumeric = ids.every(id => /^[0-9]+$/.test(id));
    const allAlphanumeric = ids.every(id => /^[A-Za-z0-9._-]+$/.test(id));

    const minLength = Math.min(...ids.map(id => id.length));
    const maxLength = Math.max(...ids.map(id => id.length));

    return {
      total: ids.length,
      hasLetters,
      hasNumbers,
      hasSpecialChars,
      allNumeric,
      allAlphanumeric,
      minLength,
      maxLength,
      examples: ids.slice(0, 5)
    };
  }, [importReport, importIdMode]);

  const handlePreview = () => {
    if (!parsedData) return;
    const result = normalizeParsedData(parsedData, mapping);
    setImportReport(result);
    setStepIndex(2);
  };

  const handleImport = async () => {
    if (!importReport) return;
    setIsLoading(true);
    try {
      const existingStudents = await db.getStudents();
      const existingIds = new Set(existingStudents.map(student => student.id));
      const existingNames = new Set(existingStudents.map(student => `${student.name}-${student.class_name}-${student.section}`.toLowerCase()));

      const generated = importReport.students.map((student, index) => {
        const trimmedId = (student.id || '').trim();
        let nextId = trimmedId;
        if (importIdMode === 'generate') {
          if (trimmedId) {
            throw new Error('وضع توليد المعرفات يتطلب أن يكون حقل المعرف فارغًا.');
          }
          nextId = buildGeneratedId(index, importIdPattern);
        } else if (importIdMode === 'replace') {
          nextId = buildGeneratedId(index, importIdPattern);
        }

        if (!nextId) {
          throw new Error('المعرف مطلوب لاستكمال الاستيراد.');
        }

        // Use flexible validation for imports (allows letters, numbers, hyphens, dots)
        const validation = validateStudentIdForImport(nextId);
        if (!validation.valid) {
          throw new Error(`معرف الطالب "${nextId}": ${validation.message}`);
        }

        return {
          id: nextId,
          name: student.name,
          class_name: student.gradeLevel,
          section: student.sectionName,
          guardian_phone: student.guardianPhone,
          is_active: true
        };
      });

      const uniqueStudents = generated.filter(student => {
        const nameKey = `${student.name}-${student.class_name}-${student.section}`.toLowerCase();
        if (existingIds.has(student.id) || existingNames.has(nameKey)) {
          return false;
        }
        existingIds.add(student.id);
        existingNames.add(nameKey);
        return true;
      });

      const saved = await db.saveStudents(uniqueStudents);
      await db.syncClassesFromStudents();
      onImported?.(importReport.students);
      setImportReport(prev => prev && ({ ...prev, report: { ...prev.report, imported: saved.length } }));
      setStepIndex(3);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'حدث خطأ أثناء حفظ البيانات. حاول مرة أخرى.';
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwap = () => {
    setMapping(prev => ({
      ...prev,
      gradeLevel: prev.sectionName,
      sectionName: prev.gradeLevel,
      defaults: {
        gradeLevel: prev.defaults?.sectionName,
        sectionName: prev.defaults?.gradeLevel
      }
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">مركز الاستيراد الذكي</h2>
          <p className="text-sm text-gray-400">استيراد CSV / XLSX / JSON مع مطابقة ذكية للأعمدة.</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white">إغلاق</button>
      </div>

      <div className="flex items-center gap-2">
        {steps.map((step, index) => (
          <div key={step} className={`flex items-center gap-2 text-xs ${index <= stepIndex ? 'text-primary-300' : 'text-gray-500'}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center border ${index <= stepIndex ? 'border-primary-400 bg-primary-500/10' : 'border-gray-600'}`}>
              {index + 1}
            </div>
            <span>{step}</span>
            {index < steps.length - 1 && <span className="text-gray-600">→</span>}
          </div>
        ))}
      </div>

      {errorMessage && (
        <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 text-sm">
          {errorMessage}
        </div>
      )}

      {stepIndex === 0 && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5">
            <label className="text-sm text-gray-300">اختر الملف</label>
            <input
              type="file"
              className="mt-2 block w-full text-sm text-gray-300"
              accept=".csv,.xlsx,.xls,.json"
              onChange={(event) => handleFileChange(event.target.files?.[0] || null)}
            />
            <p className="text-xs text-gray-500 mt-2">يدعم: CSV / XLSX / JSON.</p>
          </div>
          {isLoading && <p className="text-sm text-gray-400">جاري قراءة الملف...</p>}
        </div>
      )}

      {stepIndex >= 1 && parsedData && (
        <div className="space-y-6">
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-4">
            <div className="text-sm text-gray-300 font-bold">خيارات المعرفات</div>
            <div className="flex flex-wrap gap-2 text-xs">
              {[
                { key: 'keep', label: 'الاحتفاظ بالمعرفات' },
                { key: 'generate', label: 'توليد معرفات جديدة' },
                { key: 'replace', label: 'استبدال المعرفات' }
              ].map(option => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setImportIdMode(option.key as ImportIdMode)}
                  className={`px-3 py-2 rounded-xl border ${importIdMode === option.key ? 'bg-primary-500/20 text-primary-200 border-primary-500/50' : 'border-white/10 text-gray-400 hover:text-white'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {(importIdMode === 'generate' || importIdMode === 'replace') && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs text-gray-300">
                <label className="flex flex-col gap-2">
                  <span className="text-gray-400">بادئة المعرف</span>
                  <input
                    type="text"
                    value={importIdPattern.prefix || ''}
                    onChange={(e) => setImportIdPattern({ ...importIdPattern, prefix: e.target.value })}
                    className="input-glass p-2 rounded-xl"
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-gray-400">طول المعرف</span>
                  <input
                    type="number"
                    min={3}
                    value={importIdPattern.length || 6}
                    onChange={(e) => setImportIdPattern({ ...importIdPattern, length: Number(e.target.value) })}
                    className="input-glass p-2 rounded-xl"
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-gray-400">نوع المعرف</span>
                  <select
                    value={importIdPattern.charset || 'numeric'}
                    onChange={(e) => setImportIdPattern({ ...importIdPattern, charset: e.target.value as ImportIdPattern['charset'] })}
                    className="input-glass p-2 rounded-xl"
                  >
                    <option value="numeric">رقمي</option>
                    <option value="alphanumeric">أحرف وأرقام</option>
                  </select>
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-gray-400">بداية الترقيم</span>
                  <input
                    type="number"
                    min={1}
                    value={importIdPattern.start || 1}
                    onChange={(e) => setImportIdPattern({ ...importIdPattern, start: Number(e.target.value) })}
                    className="input-glass p-2 rounded-xl"
                  />
                </label>
                <div className="md:col-span-4 text-xs text-gray-400">
                  معاينة المعرفات: {previewGeneratedIds.slice(0, 5).join(' • ')}
                </div>
              </div>
            )}
          </div>

          <ColumnMapper
            columns={parsedData.columns}
            mapping={mapping}
            confidence={mappingSuggestion?.confidence || { id: 'Low', name: 'Low', gradeLevel: 'Low', sectionName: 'Low', guardianPhone: 'Low' }}
            warnings={mappingSuggestion?.warnings || []}
            ambiguous={Boolean(mappingSuggestion?.ambiguous)}
            onChange={setMapping}
            onSwap={handleSwap}
          />

          <PreviewTable columns={parsedData.columns} rows={previewRows} title="معاينة البيانات" />

          <div className="flex justify-end gap-3">
            <button
              type="button"
              className="px-4 py-2 rounded-xl border border-white/10 text-gray-300"
              onClick={() => setStepIndex(0)}
            >
              رجوع
            </button>
            <button
              type="button"
              disabled={!canProceedMapping}
              className={`px-4 py-2 rounded-xl font-bold ${canProceedMapping ? 'bg-emerald-600 text-white' : 'bg-gray-700 text-gray-400 cursor-not-allowed'}`}
              onClick={handlePreview}
            >
              متابعة
            </button>
          </div>
        </div>
      )}

      {stepIndex >= 2 && importReport && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'الصفوف المقروءة', value: importReport.report.totalRows },
              { label: 'الطلاب المستوردون', value: importReport.report.imported },
              { label: 'المكررة المستبعدة', value: importReport.report.duplicates },
              { label: 'صفوف ناقصة بيانات', value: importReport.report.errors.length }
            ].map(item => (
              <div key={item.label} className="p-4 rounded-2xl border border-white/10 bg-white/5">
                <div className="text-xs text-gray-400">{item.label}</div>
                <div className="text-xl font-bold text-white">{item.value}</div>
              </div>
            ))}
          </div>

          {/* Smart ID Format Analysis */}
          {importedIdAnalysis && (
            <div className="p-5 rounded-2xl border-2 border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-green-500/10">
              <div className="flex items-start gap-3 mb-4">
                <div className="text-2xl">✓</div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-emerald-400 mb-1">تحليل ذكي للمعرفات المستوردة</h4>
                  <p className="text-xs text-emerald-200/70">تم اكتشاف تنسيق المعرفات تلقائياً - النظام يدعم جميع الأنواع</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="text-xs text-gray-400 mb-1">النوع المكتشف</div>
                  <div className="text-sm font-bold text-white">
                    {importedIdAnalysis.allNumeric
                      ? '🔢 رقمي فقط'
                      : importedIdAnalysis.hasLetters
                        ? '🔤 أحرف وأرقام'
                        : '🔢 رقمي'}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="text-xs text-gray-400 mb-1">عدد المعرفات</div>
                  <div className="text-sm font-bold text-emerald-400">{importedIdAnalysis.total}</div>
                </div>

                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="text-xs text-gray-400 mb-1">أقصر معرف</div>
                  <div className="text-sm font-bold text-white">{importedIdAnalysis.minLength} خانة</div>
                </div>

                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="text-xs text-gray-400 mb-1">أطول معرف</div>
                  <div className="text-sm font-bold text-white">{importedIdAnalysis.maxLength} خانة</div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs text-gray-400">أمثلة من المعرفات ({importedIdAnalysis.examples.length}):</div>
                <div className="flex flex-wrap gap-2">
                  {importedIdAnalysis.examples.map((id, idx) => (
                    <code key={idx} className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs font-mono border border-emerald-400/30">
                      {id}
                    </code>
                  ))}
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-emerald-400/20">
                <div className="flex items-center gap-2 text-xs text-emerald-200">
                  <span>✓</span>
                  <span>
                    {importedIdAnalysis.hasLetters
                      ? 'المعرفات تحتوي على أحرف - النظام يدعم هذا التنسيق بشكل كامل'
                      : 'المعرفات رقمية - يمكنك استخدام معرفات تحتوي على أحرف أيضاً'}
                  </span>
                </div>
                {importedIdAnalysis.hasSpecialChars && (
                  <div className="flex items-center gap-2 text-xs text-emerald-200 mt-1">
                    <span>✓</span>
                    <span>تحتوي على رموز خاصة (. - _) - مدعومة بالكامل</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {importReport.report.errors.length > 0 && (
            <div className="p-4 rounded-2xl border border-amber-500/20 bg-amber-500/10">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-amber-200">سجل الأخطاء</h4>
                  <p className="text-xs text-amber-300">تم تجاهل الصفوف غير الصالحة.</p>
                </div>
                <button
                  type="button"
                  className="text-xs text-amber-200 underline"
                  onClick={() => downloadJson(importReport.report.errors, 'import-errors.json')}
                >
                  تنزيل الأخطاء
                </button>
              </div>
              <ul className="mt-2 space-y-1 text-xs text-amber-100">
                {importReport.report.errors.slice(0, 5).map(error => (
                  <li key={`${error.rowIndex}-${error.message}`}>سطر {error.rowIndex}: {error.message}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              className="px-4 py-2 rounded-xl border border-white/10 text-gray-300"
              onClick={() => setStepIndex(1)}
            >
              تعديل المطابقة
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={isLoading || importReport.students.length === 0}
              className={`px-4 py-2 rounded-xl font-bold ${importReport.students.length > 0 ? 'bg-emerald-600 text-white' : 'bg-gray-700 text-gray-400 cursor-not-allowed'}`}
            >
              {isLoading ? 'جاري الحفظ...' : 'استيراد الآن'}
            </button>
          </div>
        </div>
      )}

      {stepIndex === 3 && importReport && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-200">
            تم استيراد {importReport.report.imported} طالب بنجاح.
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="px-4 py-2 rounded-xl bg-primary-600 text-white font-bold"
              onClick={onClose}
            >
              إنهاء
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
