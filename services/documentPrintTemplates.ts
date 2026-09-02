import {
  DocumentPrintTemplate,
  DocumentPrintTemplates,
  ExitRecord,
  Student,
  SystemSettings,
  ViolationRecord
} from '../types';
import { getExitRequesterRelationLabel } from './exitRequester';

export const DEFAULT_EXIT_CARD_TEMPLATE: DocumentPrintTemplate = {
  title: 'تصريح خروج طالب',
  subtitle: 'يسمح لحامل هذه البطاقة بالخروج من بوابة المدرسة',
  body:
    'الطالب: {student_name}\n' +
    'المعرف: {student_id}\n' +
    'الصف/الفصل: {class_name} - {section}\n' +
    'سبب الاستئذان: {reason}\n' +
    'المستأذن للطالب: {requester_relation}\n' +
    'وقت الخروج: {exit_time}\n' +
    'المسجل: {recorded_by}',
  footer: 'يعتمد هذا التصريح ليوم الإصدار فقط، ويسلم عند البوابة.',
  signature_label: 'توقيع المناوب'
};

export const DEFAULT_VIOLATION_NOTICE_TEMPLATE: DocumentPrintTemplate = {
  title: 'إشعار مخالفة سلوكية',
  subtitle: 'سجل متابعة داخلي للطالب',
  body:
    'الطالب: {student_name}\n' +
    'المعرف: {student_id}\n' +
    'الصف/الفصل: {class_name} - {section}\n' +
    'نوع المخالفة: {violation_type}\n' +
    'مستوى الخطورة: {level}\n' +
    'الوصف: {description}\n' +
    'الإجراء المتخذ: {action_taken}\n' +
    'وقت التسجيل: {created_at}\n' +
    'المسجل: {recorded_by}',
  footer: 'يحفظ هذا الإشعار في ملف الطالب للمتابعة الإدارية.',
  signature_label: 'توقيع المسؤول'
};

export const getDocumentPrintTemplates = (settings?: SystemSettings | null): Required<DocumentPrintTemplates> => ({
  exit_card: {
    ...DEFAULT_EXIT_CARD_TEMPLATE,
    ...(settings?.kiosk_settings?.document_templates?.exit_card || {})
  },
  violation_notice: {
    ...DEFAULT_VIOLATION_NOTICE_TEMPLATE,
    ...(settings?.kiosk_settings?.document_templates?.violation_notice || {})
  }
});

export const mergeDocumentPrintTemplates = (
  settings: SystemSettings,
  templates: Required<DocumentPrintTemplates>
): SystemSettings => ({
  ...settings,
  kiosk_settings: {
    ...(settings.kiosk_settings || {}),
    document_templates: templates
  }
});

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const renderTemplate = (text: string | undefined, data: Record<string, string>) =>
  escapeHtml(text || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => escapeHtml(data[key] ?? ''));

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' });
};

const lineBreaks = (value: string) => value.replace(/\n/g, '<br />');

const openPrintDocument = (html: string): boolean => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;
  printWindow.document.write(html);
  printWindow.document.close();
  return true;
};

const buildDocumentHtml = (template: DocumentPrintTemplate, data: Record<string, string>) => {
  const title = renderTemplate(template.title, data);
  const subtitle = renderTemplate(template.subtitle, data);
  const body = lineBreaks(renderTemplate(template.body, data));
  const footer = renderTemplate(template.footer, data);
  const signature = renderTemplate(template.signature_label || 'التوقيع', data);

  return `
<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #f8fafc;
      color: #0f172a;
      font-family: "Tajawal", "Segoe UI", Arial, sans-serif;
    }
    .sheet {
      width: 148mm;
      min-height: 105mm;
      padding: 13mm;
      border: 1px solid #cbd5e1;
      background: #ffffff;
      position: relative;
    }
    .sheet:before {
      content: "";
      position: absolute;
      inset: 7mm;
      border: 1px solid #e2e8f0;
      pointer-events: none;
    }
    header {
      border-bottom: 2px solid #0f172a;
      padding-bottom: 8mm;
      margin-bottom: 8mm;
    }
    h1 {
      margin: 0;
      font-size: 25px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    .subtitle {
      margin-top: 8px;
      color: #475569;
      font-size: 13px;
    }
    .body {
      white-space: normal;
      font-size: 15px;
      line-height: 2;
      color: #1e293b;
    }
    .footer {
      margin-top: 9mm;
      padding-top: 5mm;
      border-top: 1px dashed #94a3b8;
      color: #475569;
      font-size: 12px;
      line-height: 1.8;
    }
    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16mm;
      margin-top: 14mm;
      font-size: 13px;
      color: #334155;
    }
    .line {
      border-top: 1px solid #64748b;
      padding-top: 7px;
      text-align: center;
    }
    @media print {
      body { background: #ffffff; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .sheet { border-color: #0f172a; box-shadow: none; }
      @page { size: A5 landscape; margin: 8mm; }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <header>
      <h1>${title}</h1>
      ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}
    </header>
    <section class="body">${body}</section>
    ${footer ? `<section class="footer">${footer}</section>` : ''}
    <section class="signatures">
      <div class="line">${signature}</div>
      <div class="line">ختم المدرسة / البوابة</div>
    </section>
  </main>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;
};

export const buildExitPrintData = (
  exit: ExitRecord,
  student: Student | undefined,
  recordedBy: string
): Record<string, string> => ({
  student_name: student?.name || exit.student_id,
  student_id: exit.student_id,
  class_name: student?.class_name || '-',
  section: student?.section || '-',
  reason: exit.reason || '-',
  requester_relation: getExitRequesterRelationLabel(exit),
  requester_relation_other: exit.requester_relation_other || '-',
  notes: exit.notes || '-',
  exit_time: formatDateTime(exit.exit_time),
  recorded_by: recordedBy || exit.supervisor_name || '-'
});

export const buildViolationPrintData = (
  violation: ViolationRecord,
  student: Student | undefined,
  recordedBy: string
): Record<string, string> => ({
  student_name: student?.name || violation.student_id,
  student_id: violation.student_id,
  class_name: student?.class_name || '-',
  section: student?.section || '-',
  violation_type: violation.type || '-',
  level: String(violation.level ?? '-'),
  description: violation.description || '-',
  action_taken: violation.action_taken || '-',
  created_at: formatDateTime(violation.created_at),
  recorded_by: recordedBy || violation.created_by_label || '-'
});

export const printExitCard = (
  exit: ExitRecord,
  student: Student | undefined,
  settings: SystemSettings | null | undefined,
  recordedBy: string
) => {
  const templates = getDocumentPrintTemplates(settings);
  return openPrintDocument(buildDocumentHtml(templates.exit_card, buildExitPrintData(exit, student, recordedBy)));
};

export const printViolationNotice = (
  violation: ViolationRecord,
  student: Student | undefined,
  settings: SystemSettings | null | undefined,
  recordedBy: string
) => {
  const templates = getDocumentPrintTemplates(settings);
  return openPrintDocument(buildDocumentHtml(templates.violation_notice, buildViolationPrintData(violation, student, recordedBy)));
};
