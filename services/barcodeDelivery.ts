// =============================================================================
// نظام حاضر (Hader) — Barcode delivery to guardians
// =============================================================================
// Turns a list of students into WhatsApp queue entries carrying their scan barcode.
// The rendering and the gateway are injected so the batching, filtering and error
// handling can be tested without a canvas or a running bridge.

import type { Student } from '../types';
import type { WhatsAppOutboundMessage } from '../modules/whatsapp';
import { resolveStudentWhatsAppPhone } from '../components/supervision/supervisionCommunication';

export const BARCODE_STATUS_LABEL = 'باركود';

export const DEFAULT_BARCODE_MESSAGE =
  'السلام عليكم ورحمة الله، ولي أمر الطالب {StudentName} المحترم.\n'
  + 'نرفق لكم باركود الحضور الخاص بالطالب. يُرجى الاحتفاظ به وإحضاره معه لتسجيل الحضور عند البوابة.\n'
  + 'رقم الطالب: {StudentId}';

/** Fill the guardian message placeholders for one student. */
export const buildBarcodeMessage = (student: Student, template?: string): string => {
  const source = (template ?? '').trim() || DEFAULT_BARCODE_MESSAGE;
  const replacements: ReadonlyArray<[RegExp, string]> = [
    [/\{(StudentName|student_name|name|اسم|الطالب|اسم_الطالب)\}/gi, student.name ?? ''],
    [/\{(StudentId|student_id|id|رقم|الرقم|رقم_الطالب)\}/gi, student.id ?? ''],
    [/\{(Class|class|class_name|صف|الصف|فصل|الفصل)\}/gi, student.class_name ?? ''],
    [/\{(Section|section|شعبة|الشعبة|القسم)\}/gi, student.section ?? '']
  ];
  return replacements.reduce((text, [pattern, value]) => text.replace(pattern, value), source).trim();
};

export type BarcodeRecipient = Readonly<{ student: Student; phone: string }>;

export type BarcodeAudience = Readonly<{
  /** Students that can actually be messaged. */
  recipients: readonly BarcodeRecipient[];
  /** Active students whose guardian phone is missing or unusable. */
  missingPhone: readonly Student[];
  /** Students skipped because they are archived. */
  inactive: readonly Student[];
}>;

/**
 * Split a student list into who can receive the barcode and who cannot.
 * Exposed on its own so the UI can warn before anything is sent.
 */
export const resolveBarcodeAudience = (students: readonly Student[]): BarcodeAudience => {
  const recipients: BarcodeRecipient[] = [];
  const missingPhone: Student[] = [];
  const inactive: Student[] = [];
  const seen = new Set<string>();

  for (const student of students) {
    if (!student?.id || seen.has(student.id)) continue;
    seen.add(student.id);

    if (student.is_active === false) {
      inactive.push(student);
      continue;
    }
    const phone = resolveStudentWhatsAppPhone(student);
    if (!phone) {
      missingPhone.push(student);
      continue;
    }
    recipients.push({ student, phone });
  }

  return { recipients, missingPhone, inactive };
};

export type BarcodeDeliveryFailure = Readonly<{ student: Student; reason: string }>;

export type BarcodeDeliveryResult = Readonly<{
  /** Messages accepted into the WhatsApp queue. */
  queued: number;
  audience: BarcodeAudience;
  failed: readonly BarcodeDeliveryFailure[];
}>;

export type BarcodeDeliveryDeps = Readonly<{
  /** Produces the PNG card for one student. */
  renderFile: (student: Student) => Promise<File>;
  gateway: Readonly<{
    upload: (file: File) => Promise<string>;
    enqueue: (messages: readonly WhatsAppOutboundMessage[]) => Promise<void>;
  }>;
  /** Message body; placeholders are filled per student. */
  template?: string;
  /** Called after every student is processed, so the UI can show progress. */
  onProgress?: (done: number, total: number, student: Student) => void;
  /** Lets the caller stop a long batch. */
  shouldContinue?: () => boolean;
}>;

const describeError = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'خطأ غير معروف';

/**
 * Render a barcode card per student, upload each one, then queue them in a single call.
 *
 * A student whose card or upload fails is reported in `failed` and does not stop the
 * rest of the batch — sending 200 cards should not be lost to one bad row.
 */
export const sendBarcodeCards = async (
  students: readonly Student[],
  deps: BarcodeDeliveryDeps
): Promise<BarcodeDeliveryResult> => {
  const audience = resolveBarcodeAudience(students);
  const failed: BarcodeDeliveryFailure[] = [];
  const outbound: WhatsAppOutboundMessage[] = [];
  const total = audience.recipients.length;

  let done = 0;
  for (const { student, phone } of audience.recipients) {
    if (deps.shouldContinue && !deps.shouldContinue()) break;

    try {
      const file = await deps.renderFile(student);
      const attachment = await deps.gateway.upload(file);
      outbound.push({
        phone,
        message: buildBarcodeMessage(student, deps.template),
        attachment,
        student_name: student.name,
        status_label: BARCODE_STATUS_LABEL
      });
    } catch (error) {
      failed.push({ student, reason: describeError(error) });
    }

    done += 1;
    deps.onProgress?.(done, total, student);
  }

  if (outbound.length > 0) {
    try {
      await deps.gateway.enqueue(outbound);
    } catch (error) {
      // The queue call is all-or-nothing, so every prepared card failed to be scheduled.
      const reason = describeError(error);
      for (const message of outbound) {
        const student = audience.recipients.find(item => item.student.name === message.student_name)?.student;
        if (student) failed.push({ student, reason });
      }
      return { queued: 0, audience, failed };
    }
  }

  return { queued: outbound.length, audience, failed };
};
