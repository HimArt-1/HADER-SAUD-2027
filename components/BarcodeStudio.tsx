import React, { useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { Student } from '../types';
import { Download, Printer, X, Settings, Eye, FileDown, Image as ImageIcon, Grid3x3, CreditCard, Tag, AlertCircle, Loader2 } from 'lucide-react';
import {
  escapeBarcodePrintHtml,
  getBarcodeTemplateConfig,
  isCode128Compatible,
  resolveBarcodeStudents,
  safeBarcodeFileStem,
  type BarcodeScope,
  type BarcodeTemplate
} from './barcode/barcodeStudioRules';

type BarcodeType = 'qr' | 'code128' | 'both';
type TemplateType = BarcodeTemplate;
type ScopeType = BarcodeScope;

type BarcodeStudioProps = {
  students: Student[];
  selectedIds: Set<string>;
  onClose: () => void;
};

type BarcodeEntry = {
  student: Student;
  qrDataUrl?: string;
  code128Svg?: string;
  warning?: string;
};

type BarcodeSettings = {
  qrSize: number;
  qrErrorCorrection: 'L' | 'M' | 'Q' | 'H';
  code128Height: number;
  code128Width: number;
  showStudentInfo: boolean;
  showLogo: boolean;
  cardBackground: string;
  textColor: string;
};

const encodeSvg = (svg: string) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

export const BarcodeStudio: React.FC<BarcodeStudioProps> = ({ students, selectedIds, onClose }) => {
  const [scope, setScope] = useState<ScopeType>('selected');
  const [barcodeType, setBarcodeType] = useState<BarcodeType>('both');
  const [template, setTemplate] = useState<TemplateType>('cards');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [entries, setEntries] = useState<BarcodeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [generationNote, setGenerationNote] = useState('');
  const [generatedFingerprint, setGeneratedFingerprint] = useState('');
  const [downloadLoading, setDownloadLoading] = useState(false);
  const generationRequestRef = useRef(0);

  const [settings, setSettings] = useState<BarcodeSettings>({
    qrSize: 256,
    qrErrorCorrection: 'M',
    code128Height: 60,
    code128Width: 2,
    showStudentInfo: true,
    showLogo: false,
    cardBackground: '#ffffff',
    textColor: '#000000'
  });

  const gradeOptions = useMemo(() => {
    const unique = Array.from(new Set(students.map(s => s.class_name).filter(Boolean)));
    return unique.sort((a, b) => a.localeCompare(b, 'ar'));
  }, [students]);

  const sectionOptions = useMemo(() => {
    if (!selectedGrade) return [];
    const unique = Array.from(new Set(students.filter(s => s.class_name === selectedGrade).map(s => s.section).filter(Boolean)));
    return unique.sort((a, b) => a.localeCompare(b, 'ar'));
  }, [students, selectedGrade]);

  const selection = useMemo(() => resolveBarcodeStudents({
    students,
    scope,
    selectedIds,
    studentId: selectedStudentId,
    grade: selectedGrade,
    section: selectedSection
  }), [scope, students, selectedIds, selectedStudentId, selectedGrade, selectedSection]);
  const filteredStudents = selection.validStudents;
  const validSelectedCount = useMemo(() => resolveBarcodeStudents({
    students,
    scope: 'selected',
    selectedIds
  }).validStudents.length, [students, selectedIds]);

  const generationFingerprint = useMemo(() => JSON.stringify({
    ids: filteredStudents.map(student => student.id),
    barcodeType,
    qrSize: settings.qrSize,
    qrErrorCorrection: settings.qrErrorCorrection,
    code128Height: settings.code128Height,
    code128Width: settings.code128Width,
    cardBackground: settings.cardBackground,
    textColor: settings.textColor
  }), [filteredStudents, barcodeType, settings]);
  const generationIsStale = entries.length > 0 && generatedFingerprint !== generationFingerprint;
  const previewEntries = entries.slice(0, 60);

  useEffect(() => () => {
    generationRequestRef.current += 1;
  }, []);

  const closeStudio = () => {
    generationRequestRef.current += 1;
    onClose();
  };

  const resetGeneratedOutput = () => {
    setEntries([]);
    setGeneratedFingerprint('');
    setGenerationNote('');
    setErrorMessage('');
  };

  const buildCode128Svg = (value: string, activeSettings: BarcodeSettings) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, value, {
      format: 'CODE128',
      displayValue: false,
      height: activeSettings.code128Height,
      width: activeSettings.code128Width,
      margin: 0
    });
    return svg.outerHTML;
  };

  const generateBarcodes = async () => {
    if (filteredStudents.length === 0) {
      setErrorMessage('اختر طالبًا واحدًا على الأقل ضمن نطاقك الحالي.');
      return;
    }

    const requestId = generationRequestRef.current + 1;
    generationRequestRef.current = requestId;
    const clamp = (value: number, min: number, max: number, fallback: number) =>
      Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
    const activeSettings: BarcodeSettings = {
      ...settings,
      qrSize: clamp(settings.qrSize, 128, 512, 256),
      code128Height: clamp(settings.code128Height, 40, 100, 60),
      code128Width: clamp(settings.code128Width, 1, 4, 2),
      cardBackground: /^#[0-9a-f]{6}$/i.test(settings.cardBackground) ? settings.cardBackground : '#ffffff',
      textColor: /^#[0-9a-f]{6}$/i.test(settings.textColor) ? settings.textColor : '#000000'
    };
    setSettings(activeSettings);
    setLoading(true);
    setProgress(0);
    setErrorMessage('');
    setGenerationNote('');
    try {
      const totalStudents = filteredStudents.length;
      const nextEntries: BarcodeEntry[] = [];
      let code128Warnings = 0;

      const batchSize = 10;
      for (let i = 0; i < totalStudents; i += batchSize) {
        const batch = filteredStudents.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(async (student) => {
          const entry: BarcodeEntry = { student };

          if (barcodeType === 'qr' || barcodeType === 'both') {
            entry.qrDataUrl = await QRCode.toDataURL(student.id, {
              margin: 1,
              width: activeSettings.qrSize,
              errorCorrectionLevel: activeSettings.qrErrorCorrection,
              color: { dark: activeSettings.textColor, light: activeSettings.cardBackground }
            });
          }

          if (barcodeType === 'code128' || barcodeType === 'both') {
            if (isCode128Compatible(student.id)) {
              entry.code128Svg = buildCode128Svg(student.id, activeSettings);
            } else {
              entry.warning = 'المعرّف لا يدعم Code128؛ استخدم QR لهذا الطالب.';
            }
          }
          return entry;
        }));

        if (generationRequestRef.current !== requestId) return;
        for (const entry of batchResults) {
          if (entry.warning) code128Warnings += 1;
          if (entry.qrDataUrl || entry.code128Svg) nextEntries.push(entry);
        }
        setProgress(Math.round(((i + batch.length) / totalStudents) * 100));
        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      }

      if (generationRequestRef.current !== requestId) return;
      setEntries(nextEntries);
      setGeneratedFingerprint(JSON.stringify({
        ids: filteredStudents.map(student => student.id),
        barcodeType,
        qrSize: activeSettings.qrSize,
        qrErrorCorrection: activeSettings.qrErrorCorrection,
        code128Height: activeSettings.code128Height,
        code128Width: activeSettings.code128Width,
        cardBackground: activeSettings.cardBackground,
        textColor: activeSettings.textColor
      }));
      setGenerationNote([
        selection.invalidStudents.length > 0 ? `تم تجاوز ${selection.invalidStudents.length} سجل بلا معرّف صالح أو مكرر.` : '',
        code128Warnings > 0 ? `${code128Warnings} معرّف لا يدعم Code128.` : ''
      ].filter(Boolean).join(' '));
      if (nextEntries.length === 0) {
        setErrorMessage('تعذر توليد أي باركود بالقيمة المختارة. جرّب QR للمعرّفات العربية.');
      } else {
        setShowPreview(true);
      }
    } catch (error) {
      if (generationRequestRef.current !== requestId) return;
      setErrorMessage(error instanceof Error ? `تعذر توليد الباركود: ${error.message}` : 'تعذر توليد الباركود.');
    } finally {
      if (generationRequestRef.current === requestId) {
        setLoading(false);
        setProgress(0);
      }
    }
  };

  const getTemplateStyles = () => {
    return getBarcodeTemplateConfig(template);
  };

  const handlePrint = () => {
    if (entries.length === 0) {
      setErrorMessage('ولّد الباركود قبل الطباعة.');
      return;
    }
    if (generationIsStale) {
      setErrorMessage('تغيّرت إعدادات التوليد. أعد التوليد قبل الطباعة.');
      return;
    }
    const templateStyles = getTemplateStyles();
    const logoHtml = settings.showLogo ? `
      <div style="text-align: center; margin-bottom: 20px;">
        <div style="font-size: 24px; font-weight: 700; color: #1e40af;">نظام حاضر - HADER</div>
        <div style="font-size: 12px; color: #6b7280;">بطاقات الطلاب</div>
      </div>
    ` : '';

    const html = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>طباعة الباركود - ${entries.length} طالب</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }

          body {
            font-family: Tahoma, Arial, sans-serif;
            padding: 20mm;
            background: #f3f4f6;
            color: ${settings.textColor};
          }

          @media print {
            body { background: white; padding: 10mm; }
            .no-print { display: none !important; }
            .page-break { grid-column: 1 / -1; height: 0; page-break-after: always; break-after: page; }
          }

          .container {
            max-width: 1200px;
            margin: 0 auto;
          }

          .header {
            text-align: center;
            margin-bottom: 20px;
            padding: 15px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 12px;
          }

          .grid {
            display: grid;
            grid-template-columns: repeat(${templateStyles.printColumns}, minmax(0, 1fr));
            gap: ${template === 'labels' ? '8px' : '16px'};
            margin-bottom: 20px;
          }

          .card {
            ${templateStyles.cardCss}
            text-align: center;
            page-break-inside: avoid;
            break-inside: avoid;
          }

          ${template === 'id-cards' ? `
          .card {
            min-height: 180px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            background: linear-gradient(135deg, #ffffff 0%, #f9fafb 100%);
          }
          ` : ''}

          .card-header {
            margin-bottom: ${template === 'labels' ? '6px' : '12px'};
          }

          .student-name {
            font-weight: 700;
            font-size: ${template === 'labels' ? '13px' : template === 'id-cards' ? '18px' : '16px'};
            color: ${settings.textColor};
            margin-bottom: 4px;
          }

          .student-meta {
            color: #6b7280;
            font-size: ${template === 'labels' ? '10px' : '12px'};
            margin-bottom: 2px;
          }

          .barcode-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: ${template === 'labels' ? '6px' : '12px'};
            margin: ${template === 'labels' ? '6px 0' : '12px 0'};
          }

          .qr-code {
            max-width: ${template === 'labels' ? '100px' : template === 'id-cards' ? '120px' : '180px'};
            height: auto;
            background: white;
            padding: ${template === 'labels' ? '4px' : '8px'};
            border-radius: 8px;
            border: 1px solid #e5e7eb;
          }

          .code128 {
            width: ${template === 'labels' ? '140px' : template === 'id-cards' ? '160px' : '220px'};
            height: auto;
          }

          .student-id {
            font-size: ${template === 'labels' ? '10px' : '11px'};
            color: #9ca3af;
            margin-top: 6px;
            font-weight: 600;
            letter-spacing: 1px;
          }

          .footer {
            text-align: center;
            margin-top: 30px;
            padding: 15px;
            color: #6b7280;
            font-size: 11px;
            border-top: 2px solid #e5e7eb;
          }

          @media print {
            @page {
              size: ${templateStyles.orientation === 'landscape' ? 'A4 landscape' : 'A4 portrait'};
              margin: 10mm;
            }

            .grid {
              gap: ${template === 'labels' ? '4px' : '8px'};
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          ${logoHtml}
          <div class="header no-print">
            <h1 style="font-size: 20px; margin-bottom: 5px;">بطاقات الطلاب</h1>
            <p style="font-size: 13px; opacity: 0.9;">عدد الطلاب: ${entries.length}</p>
          </div>

          <div class="grid">
            ${entries.map(({ student, qrDataUrl, code128Svg }, index) => `
              <div class="card">
                ${settings.showStudentInfo && template !== 'raw' ? `
                  <div class="card-header">
                    <div class="student-name">${escapeBarcodePrintHtml(student.name)}</div>
                    <div class="student-meta">${escapeBarcodePrintHtml(student.class_name)} - ${escapeBarcodePrintHtml(student.section)}</div>
                    ${template === 'id-cards' ? `<div class="student-meta">رقم الطالب: ${escapeBarcodePrintHtml(student.id)}</div>` : ''}
                  </div>
                ` : ''}

                <div class="barcode-container">
                  ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR Code" class="qr-code" />` : ''}
                  ${code128Svg ? `<div class="code128">${code128Svg}</div>` : ''}
                </div>

                ${settings.showStudentInfo && template !== 'raw' ? `
                  <div class="student-id">#${escapeBarcodePrintHtml(student.id)}</div>
                ` : ''}
              </div>
              ${(index + 1) % templateStyles.cardsPerPage === 0 && index + 1 < entries.length ? '<div class="page-break"></div>' : ''}
            `).join('')}
          </div>

          <div class="footer">
            <p>نظام حاضر - HADER | تم الطباعة بتاريخ: ${new Date().toLocaleDateString('ar-SA')}</p>
          </div>
        </div>
        <script>
          window.onload = () => {
            setTimeout(() => window.print(), 500);
          };
        </script>
      </body>
      </html>
    `;

    const win = window.open('', '_blank');
    if (!win) {
      setErrorMessage('تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');
      return;
    }
    win.document.write(html);
    win.document.close();
  };

  const handleDownloadAll = async () => {
    if (entries.length === 0) {
      setErrorMessage('ولّد الباركود قبل تنزيل الملفات.');
      return;
    }
    if (generationIsStale) {
      setErrorMessage('تغيّرت إعدادات التوليد. أعد التوليد قبل تنزيل الملفات.');
      return;
    }

    setDownloadLoading(true);
    setErrorMessage('');
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const folder = zip.folder('barcodes');

      entries.forEach(({ student, qrDataUrl, code128Svg }) => {
        const fileStem = safeBarcodeFileStem(student);
        if (qrDataUrl && folder) {
          const base64Data = qrDataUrl.split(',')[1];
          folder.file(`${fileStem}-qr.png`, base64Data, { base64: true });
        }
        if (code128Svg && folder) {
          folder.file(`${fileStem}-code128.svg`, code128Svg);
        }
      });

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `barcodes-${new Date().toISOString().split('T')[0]}.zip`;
      a.hidden = true;
      document.body.appendChild(a);
      a.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 1_000);
      setGenerationNote(`تم تجهيز ملف ZIP ويحتوي على باركود ${entries.length} طالب.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? `تعذر تجهيز ملف ZIP: ${error.message}` : 'تعذر تجهيز ملف ZIP.');
    } finally {
      setDownloadLoading(false);
    }
  };

  const templateStyles = getTemplateStyles();

  return createPortal(
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[300] flex items-center justify-center p-2 sm:p-4 animate-fade-in"
      onClick={closeStudio}
      role="dialog"
      aria-modal="true"
      aria-labelledby="barcode-studio-title"
    >
      <div
        className="glass-card w-full max-w-6xl h-[94dvh] sm:h-[92dvh] rounded-3xl relative animate-fade-in-up border border-white/20 text-right flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fixed Header */}
        <div className="flex-shrink-0 p-6 pb-4 border-b border-white/10 bg-gradient-to-b from-slate-900/95 to-transparent backdrop-blur-xl">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={closeStudio}
              className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-all hover:scale-110"
              title="إغلاق"
              aria-label="إغلاق استوديو الباركود"
            >
              <X className="w-6 h-6" />
            </button>
            <h3 id="barcode-studio-title" className="text-2xl font-bold text-white flex items-center gap-2">
              <ImageIcon className="w-7 h-7 text-primary-400" />
              استوديو الباركود المتقدم
            </h3>
          </div>

          {/* Controls Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">النطاق</label>
            <select
              value={scope}
              onChange={e => {
                setScope(e.target.value as ScopeType);
                resetGeneratedOutput();
              }}
              className="w-full input-glass p-3 rounded-xl text-sm"
            >
              <option value="selected">المحددون ضمن النطاق ({validSelectedCount})</option>
              <option value="single">طالب واحد</option>
              <option value="grade">حسب الصف</option>
              <option value="section">حسب الصف والفصل</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">نوع الباركود</label>
            <select
              value={barcodeType}
              onChange={e => {
                setBarcodeType(e.target.value as BarcodeType);
                resetGeneratedOutput();
              }}
              className="w-full input-glass p-3 rounded-xl text-sm"
            >
              <option value="both">QR + Code128</option>
              <option value="qr">QR فقط</option>
              <option value="code128">Code128 فقط</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">القالب</label>
            <select
              value={template}
              onChange={e => setTemplate(e.target.value as TemplateType)}
              className="w-full input-glass p-3 rounded-xl text-sm"
            >
              <option value="cards">🎴 بطاقات فردية</option>
              <option value="id-cards">🪪 بطاقات هوية</option>
              <option value="sheet">📊 شبكة متعددة</option>
              <option value="labels">🏷️ ملصقات</option>
              <option value="raw">⚡ باركود فقط</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex-1 px-3 py-3 rounded-xl bg-white/10 text-white border border-white/10 hover:bg-white/20 flex items-center justify-center gap-2 transition-all"
              title="الإعدادات المتقدمة"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={generateBarcodes}
              disabled={loading || filteredStudents.length === 0}
              className="flex-[2] px-4 py-3 rounded-xl bg-gradient-to-r from-primary-600 to-secondary-600 text-white font-bold hover:from-primary-500 hover:to-secondary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-primary-500/50"
            >
              {loading ? `جاري التوليد... ${progress}%` : `توليد (${filteredStudents.length})`}
            </button>
          </div>
        </div>
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-6 pt-4 custom-scrollbar scroll-smooth">

        {/* Progress Bar */}
        {loading && (
          <div className="mb-4">
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary-500 to-secondary-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-xs text-gray-400 mt-1 text-center">
              جاري معالجة {Math.round((progress / 100) * filteredStudents.length)} من {filteredStudents.length} طالب
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-100" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {generationIsStale && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">
            <span>تغيّر النطاق أو إعداد التوليد؛ المعاينة الحالية قديمة.</span>
            <button onClick={generateBarcodes} disabled={loading} className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-bold text-slate-950 disabled:opacity-50">
              إعادة التوليد
            </button>
          </div>
        )}

        {generationNote && !generationIsStale && (
          <div className="mb-4 rounded-xl border border-sky-400/15 bg-sky-500/10 px-4 py-3 text-sm text-sky-100" role="status">
            {generationNote}
          </div>
        )}

        {/* Advanced Settings Panel */}
        {showSettings && (
          <div className="mb-4 p-4 rounded-xl bg-white/5 border border-white/10">
            <h4 className="text-sm font-bold text-white mb-3">إعدادات متقدمة</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">حجم QR</label>
                <input
                  type="number"
                  value={settings.qrSize}
                  onChange={e => setSettings(previous => ({ ...previous, qrSize: Number(e.target.value) }))}
                  className="w-full input-glass p-2 rounded-lg text-sm"
                  min="128"
                  max="512"
                  step="32"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">تصحيح الأخطاء</label>
                <select
                  value={settings.qrErrorCorrection}
                  onChange={e => setSettings(previous => ({ ...previous, qrErrorCorrection: e.target.value as BarcodeSettings['qrErrorCorrection'] }))}
                  className="w-full input-glass p-2 rounded-lg text-sm"
                >
                  <option value="L">منخفض (7%)</option>
                  <option value="M">متوسط (15%)</option>
                  <option value="Q">عالي (25%)</option>
                  <option value="H">عالي جداً (30%)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">ارتفاع Code128</label>
                <input
                  type="number"
                  value={settings.code128Height}
                  onChange={e => setSettings(previous => ({ ...previous, code128Height: Number(e.target.value) }))}
                  className="w-full input-glass p-2 rounded-lg text-sm"
                  min="40"
                  max="100"
                  step="10"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">سُمك Code128</label>
                <input
                  type="number"
                  value={settings.code128Width}
                  onChange={e => setSettings(previous => ({ ...previous, code128Width: Number(e.target.value) }))}
                  className="w-full input-glass p-2 rounded-lg text-sm"
                  min="1"
                  max="4"
                  step="0.5"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">لون الباركود</label>
                <input
                  type="color"
                  value={settings.textColor}
                  onChange={e => setSettings(previous => ({ ...previous, textColor: e.target.value }))}
                  className="h-10 w-full rounded-lg border border-white/10 bg-white/5 p-1"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">خلفية QR</label>
                <input
                  type="color"
                  value={settings.cardBackground}
                  onChange={e => setSettings(previous => ({ ...previous, cardBackground: e.target.value }))}
                  className="h-10 w-full rounded-lg border border-white/10 bg-white/5 p-1"
                />
              </div>
              <div className="flex flex-col justify-end gap-2">
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.showStudentInfo}
                    onChange={e => setSettings(previous => ({ ...previous, showStudentInfo: e.target.checked }))}
                    className="rounded"
                  />
                  عرض معلومات الطالب
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.showLogo}
                    onChange={e => setSettings(previous => ({ ...previous, showLogo: e.target.checked }))}
                    className="rounded"
                  />
                  عرض عنوان حاضر في الطباعة
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Scope-specific Controls */}
        {scope === 'single' && (
          <select
            value={selectedStudentId}
            onChange={e => {
              setSelectedStudentId(e.target.value);
              resetGeneratedOutput();
            }}
            className="w-full input-glass p-3 rounded-xl text-sm mb-4"
          >
            <option value="">اختر طالبًا...</option>
            {students.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.class_name}/{s.section}) - #{s.id}
              </option>
            ))}
          </select>
        )}

        {scope === 'grade' && (
          <select
            value={selectedGrade}
            onChange={e => {
              setSelectedGrade(e.target.value);
              resetGeneratedOutput();
            }}
            className="w-full input-glass p-3 rounded-xl text-sm mb-4"
          >
            <option value="">اختر الصف...</option>
            {gradeOptions.map(grade => (
              <option key={grade} value={grade}>
                {grade} ({students.filter(s => s.class_name === grade).length} طالب)
              </option>
            ))}
          </select>
        )}

        {scope === 'section' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <select
              value={selectedGrade}
              onChange={e => {
                setSelectedGrade(e.target.value);
                setSelectedSection('');
                resetGeneratedOutput();
              }}
              className="input-glass p-3 rounded-xl text-sm"
            >
              <option value="">اختر الصف...</option>
              {gradeOptions.map(grade => (
                <option key={grade} value={grade}>
                  {grade}
                </option>
              ))}
            </select>
            <select
              value={selectedSection}
              onChange={e => {
                setSelectedSection(e.target.value);
                resetGeneratedOutput();
              }}
              className="input-glass p-3 rounded-xl text-sm"
              disabled={!selectedGrade}
            >
              <option value="">اختر الفصل...</option>
              {sectionOptions.map(section => (
                <option key={section} value={section}>
                  {section} ({students.filter(s => s.class_name === selectedGrade && s.section === section).length} طالب)
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Action Bar */}
        {entries.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 p-3 bg-white/5 rounded-xl border border-white/10">
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-300">
                <span className="font-bold text-white">{entries.length}</span> سجل
              </div>
              <div className="text-xs text-gray-400">
                {barcodeType === 'both' ? 'QR + Code128' : barcodeType === 'qr' ? 'QR فقط' : 'Code128 فقط'}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="px-3 py-2 rounded-lg bg-white/10 text-white border border-white/10 hover:bg-white/20 flex items-center gap-2 text-sm transition-all"
              >
                <Eye className="w-4 h-4" />
                {showPreview ? 'إخفاء' : 'معاينة'}
              </button>
              <button
                onClick={handleDownloadAll}
                disabled={downloadLoading || generationIsStale}
                className="px-3 py-2 rounded-lg bg-secondary-600 text-white hover:bg-secondary-500 flex items-center gap-2 text-sm transition-all disabled:cursor-not-allowed disabled:opacity-50"
              >
                {downloadLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                {downloadLoading ? 'جارٍ التجهيز…' : 'تحميل الكل (ZIP)'}
              </button>
              <button
                onClick={handlePrint}
                disabled={generationIsStale}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold hover:from-green-500 hover:to-emerald-500 flex items-center gap-2 text-sm transition-all shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Printer className="w-4 h-4" />
                طباعة
              </button>
            </div>
          </div>
        )}

        {/* Results Grid */}
        {showPreview && entries.length > 0 && (
          <div className="space-y-4">
            <div className="text-xs text-gray-400 text-center">
              معاينة - سيتم طباعة {entries.length} بطاقة
            </div>
            {entries.length > previewEntries.length && (
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center text-xs text-slate-400">
                تعرض المعاينة أول {previewEntries.length} بطاقة للمحافظة على سرعة الواجهة؛ الطباعة وZIP يشملان {entries.length} بطاقة.
              </div>
            )}
            <div className={`grid ${templateStyles.previewGridClass} gap-4`}>
              {previewEntries.map(({ student, qrDataUrl, code128Svg, warning }) => (
                <div
                  key={student.id}
                  className={`p-4 rounded-2xl border border-white/10 ${
                    template === 'id-cards'
                      ? 'bg-gradient-to-br from-white/10 to-white/5'
                      : 'bg-white/5'
                  } text-center hover:bg-white/10 transition-all`}
                >
                  {settings.showStudentInfo && template !== 'raw' && (
                    <div className="mb-3">
                      <div className="text-white font-bold text-sm mb-1">{student.name}</div>
                      <div className="text-xs text-gray-400">
                        {student.class_name} - {student.section}
                      </div>
                      {template === 'id-cards' && (
                        <div className="text-xs text-gray-500 mt-1">#{student.id}</div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col items-center gap-3">
                    {qrDataUrl && (
                      <img
                        src={qrDataUrl}
                        alt={`QR للطالب ${student.name}`}
                        className={`object-contain bg-white p-2 rounded-xl ${
                          template === 'labels' ? 'w-24 h-24' : template === 'id-cards' ? 'w-32 h-32' : 'w-40 h-40'
                        }`}
                      />
                    )}
                    {code128Svg && (
                      <img
                        src={encodeSvg(code128Svg)}
                        alt={`Code128 للطالب ${student.name}`}
                        className={template === 'labels' ? 'h-12' : 'h-16'}
                      />
                    )}
                  </div>

                  {warning && (
                    <p className="mt-2 text-xs text-amber-300">{warning}</p>
                  )}

                  {settings.showStudentInfo && template !== 'id-cards' && (
                    <div className="mt-3 flex items-center justify-center gap-3 text-xs">
                      <span className="text-gray-400">#{student.id}</span>
                      {qrDataUrl && (
                        <a
                          href={qrDataUrl}
                          download={`${safeBarcodeFileStem(student)}-qr.png`}
                          className="inline-flex items-center gap-1 text-primary-300 hover:text-primary-200 transition-colors"
                          onClick={e => e.stopPropagation()}
                        >
                          <Download className="w-3 h-3" /> PNG
                        </a>
                      )}
                      {code128Svg && (
                        <a
                          href={encodeSvg(code128Svg)}
                          download={`${safeBarcodeFileStem(student)}-code128.svg`}
                          className="inline-flex items-center gap-1 text-secondary-300 hover:text-secondary-200 transition-colors"
                          onClick={e => e.stopPropagation()}
                        >
                          <Download className="w-3 h-3" /> SVG
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && entries.length === 0 && (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white/5 mb-4">
              <ImageIcon className="w-10 h-10 text-gray-400" />
            </div>
            <h4 className="text-lg font-bold text-white mb-2">
              {filteredStudents.length > 0 ? 'ابدأ بتوليد الباركود' : 'حدد نطاقًا يحتوي على طلاب'}
            </h4>
            <p className="text-sm text-gray-400 mb-4">
              {filteredStudents.length > 0
                ? 'اختر نوع الباركود والقالب ثم اضغط على «توليد».'
                : scope === 'selected'
                  ? 'لا يوجد طلاب صالحون ضمن التحديد الحالي. أغلق الاستوديو وعدّل التصفية أو اختر نطاقًا آخر.'
                  : 'اختر الطالب أو الصف أو الفصل أولًا.'}
            </p>
            <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
              <div className="flex items-center gap-1">
                <Grid3x3 className="w-4 h-4" />
                <span>معالجة جماعية</span>
              </div>
              <div className="flex items-center gap-1">
                <CreditCard className="w-4 h-4" />
                <span>قوالب متعددة</span>
              </div>
              <div className="flex items-center gap-1">
                <Tag className="w-4 h-4" />
                <span>جودة عالية</span>
              </div>
            </div>
          </div>
        )}

        </div>
        {/* End Scrollable Content */}
      </div>
    </div>,
    document.body
  );
};
