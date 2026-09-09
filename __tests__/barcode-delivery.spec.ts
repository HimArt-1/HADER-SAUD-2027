import { describe, expect, it, vi } from 'vitest';
import type { Student } from '../types';
import {
  BARCODE_STATUS_LABEL,
  buildBarcodeMessage,
  DEFAULT_BARCODE_MESSAGE,
  resolveBarcodeAudience,
  sendBarcodeCards
} from '../services/barcodeDelivery';

const student = (overrides: Partial<Student> & Pick<Student, 'id' | 'name'>): Student => ({
  class_name: 'أول ثانوي',
  section: '1',
  guardian_phone: '0501234567',
  ...overrides
} as Student);

const makeDeps = (overrides: Partial<Parameters<typeof sendBarcodeCards>[1]> = {}) => {
  const uploaded: string[] = [];
  const enqueued: unknown[][] = [];
  const gateway = {
    upload: vi.fn(async (file: File) => {
      uploaded.push(file.name);
      return `/uploads/${file.name}`;
    }),
    enqueue: vi.fn(async (messages: readonly unknown[]) => {
      enqueued.push([...messages]);
    })
  };
  const renderFile = vi.fn(async (target: Student) =>
    new File(['png'], `barcode_${target.id}.png`, { type: 'image/png' }));

  return { deps: { renderFile, gateway, ...overrides }, gateway, renderFile, uploaded, enqueued };
};

describe('barcode message templating', () => {
  it('fills the student placeholders and keeps the default wording', () => {
    const message = buildBarcodeMessage(student({ id: 'HDR100', name: 'أحمد العتيبي' }));
    expect(message).toContain('أحمد العتيبي');
    expect(message).toContain('HDR100');
    expect(message).not.toContain('{');
  });

  it('supports a custom template with Arabic and English placeholders', () => {
    const message = buildBarcodeMessage(
      student({ id: 'HDR7', name: 'سارة', class_name: 'ثالث', section: 'ب' }),
      'باركود {الطالب} من {الصف}/{Section} — رقم {StudentId}'
    );
    expect(message).toBe('باركود سارة من ثالث/ب — رقم HDR7');
  });

  it('falls back to the default when the template is blank', () => {
    expect(buildBarcodeMessage(student({ id: 'A', name: 'ب' }), '   '))
      .toBe(buildBarcodeMessage(student({ id: 'A', name: 'ب' })));
    expect(DEFAULT_BARCODE_MESSAGE).toContain('{StudentName}');
  });
});

describe('barcode audience', () => {
  it('separates reachable students, missing phones and archived rows', () => {
    const audience = resolveBarcodeAudience([
      student({ id: '1', name: 'أ', guardian_phone: '0501112222' }),
      student({ id: '2', name: 'ب', guardian_phone: '', parent_phone: '', whatsapp_phone: '' }),
      student({ id: '3', name: 'ج', is_active: false }),
      student({ id: '4', name: 'د', guardian_phone: '12' })            // not a Saudi mobile
    ]);

    expect(audience.recipients.map(r => r.student.id)).toEqual(['1']);
    expect(audience.recipients[0].phone).toBe('966501112222');
    expect(audience.missingPhone.map(s => s.id)).toEqual(['2', '4']);
    expect(audience.inactive.map(s => s.id)).toEqual(['3']);
  });

  it('prefers the WhatsApp number and ignores duplicate rows', () => {
    const audience = resolveBarcodeAudience([
      student({ id: '9', name: 'أ', whatsapp_phone: '0555555555', guardian_phone: '0501112222' }),
      student({ id: '9', name: 'أ مكرر' })
    ]);
    expect(audience.recipients).toHaveLength(1);
    expect(audience.recipients[0].phone).toBe('966555555555');
  });
});

describe('sending barcode cards', () => {
  it('renders, uploads and queues one message per reachable student', async () => {
    const { deps, gateway, enqueued } = makeDeps();
    const students = [
      student({ id: 'S1', name: 'أحمد' }),
      student({ id: 'S2', name: 'خالد', whatsapp_phone: '0555555555' })
    ];

    const result = await sendBarcodeCards(students, deps);

    expect(result.queued).toBe(2);
    expect(result.failed).toEqual([]);
    expect(gateway.upload).toHaveBeenCalledTimes(2);
    // One queue call for the whole batch, not one per student.
    expect(gateway.enqueue).toHaveBeenCalledTimes(1);
    expect(enqueued[0]).toMatchObject([
      { phone: '966501234567', student_name: 'أحمد', attachment: '/uploads/barcode_S1.png', status_label: BARCODE_STATUS_LABEL },
      { phone: '966555555555', student_name: 'خالد', attachment: '/uploads/barcode_S2.png' }
    ]);
  });

  it('never contacts a student without a usable guardian number', async () => {
    const { deps, gateway } = makeDeps();
    const result = await sendBarcodeCards(
      [student({ id: 'S1', name: 'بدون رقم', guardian_phone: '' })],
      deps
    );

    expect(result.queued).toBe(0);
    expect(result.audience.missingPhone.map(s => s.id)).toEqual(['S1']);
    expect(gateway.upload).not.toHaveBeenCalled();
    expect(gateway.enqueue).not.toHaveBeenCalled();
  });

  it('keeps going when one card fails and reports the reason', async () => {
    const { deps, gateway } = makeDeps();
    deps.renderFile = vi.fn(async (target: Student) => {
      if (target.id === 'BAD') throw new Error('تعذر إنشاء صورة الباركود');
      return new File(['png'], `barcode_${target.id}.png`, { type: 'image/png' });
    });

    const result = await sendBarcodeCards(
      [student({ id: 'OK1', name: 'أ' }), student({ id: 'BAD', name: 'ب' }), student({ id: 'OK2', name: 'ج' })],
      deps
    );

    expect(result.queued).toBe(2);
    expect(result.failed).toEqual([
      { student: expect.objectContaining({ id: 'BAD' }), reason: 'تعذر إنشاء صورة الباركود' }
    ]);
    expect(gateway.enqueue).toHaveBeenCalledTimes(1);
  });

  it('records an upload failure without losing the rest of the batch', async () => {
    const { deps, gateway } = makeDeps();
    gateway.upload = vi.fn(async (file: File) => {
      if (file.name.includes('S2')) throw new Error('فشل رفع الملف');
      return `/uploads/${file.name}`;
    });

    const result = await sendBarcodeCards(
      [student({ id: 'S1', name: 'أ' }), student({ id: 'S2', name: 'ب' })],
      deps
    );

    expect(result.queued).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toBe('فشل رفع الملف');
  });

  it('reports every card as failed when the queue call itself is rejected', async () => {
    const { deps, gateway } = makeDeps();
    gateway.enqueue = vi.fn(async () => { throw new Error('تعذر الاتصال بخادم واتساب'); });

    const result = await sendBarcodeCards(
      [student({ id: 'S1', name: 'أ' }), student({ id: 'S2', name: 'ب' })],
      deps
    );

    expect(result.queued).toBe(0);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0].reason).toBe('تعذر الاتصال بخادم واتساب');
  });

  it('reports progress after each student', async () => {
    const seen: Array<[number, number, string]> = [];
    const { deps } = makeDeps({
      onProgress: (done, total, current) => seen.push([done, total, current.id])
    });

    await sendBarcodeCards(
      [student({ id: 'S1', name: 'أ' }), student({ id: 'S2', name: 'ب' })],
      deps
    );

    expect(seen).toEqual([[1, 2, 'S1'], [2, 2, 'S2']]);
  });

  it('stops early when the caller cancels', async () => {
    let processed = 0;
    const { deps, gateway } = makeDeps({ shouldContinue: () => processed < 1 });
    deps.onProgress = () => { processed += 1; };

    const result = await sendBarcodeCards(
      [student({ id: 'S1', name: 'أ' }), student({ id: 'S2', name: 'ب' }), student({ id: 'S3', name: 'ج' })],
      deps
    );

    expect(result.queued).toBe(1);
    expect(gateway.upload).toHaveBeenCalledTimes(1);
  });
});
