import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Student } from '../types';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(async (file: File) => `/uploads/${file.name}`),
  enqueue: vi.fn(async () => undefined),
  renderFile: vi.fn(async (student: { id: string }) =>
    new File(['png'], `barcode_${student.id}.png`, { type: 'image/png' }))
}));

vi.mock('../services/whatsappGateway', () => ({
  whatsappGateway: { upload: mocks.upload, enqueue: mocks.enqueue }
}));
vi.mock('../services/barcodeCard', () => ({
  renderBarcodeCardFile: mocks.renderFile,
  renderBarcodeCardPng: vi.fn(),
  barcodeCardFileName: (s: { id: string }) => `barcode_${s.id}.png`
}));

import BarcodeBroadcastCard from '../components/whatsapp/BarcodeBroadcastCard';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const student = (id: string, overrides: Partial<Student> = {}): Student => ({
  id,
  name: `طالب ${id}`,
  class_name: 'أول',
  section: '1',
  guardian_phone: '0501234567',
  ...overrides
} as Student);

const renderCard = (
  students: Student[],
  overrides: Partial<React.ComponentProps<typeof BarcodeBroadcastCard>> = {}
) => {
  const confirm = vi.fn(async () => true);
  const onNotify = vi.fn();
  const onCompleted = vi.fn();
  const utils = render(
    <BarcodeBroadcastCard
      students={students}
      confirm={confirm}
      onNotify={onNotify}
      onCompleted={onCompleted}
      {...overrides}
    />
  );
  return { ...utils, confirm, onNotify, onCompleted };
};

const sendButton = () => screen.getByTestId('barcode-broadcast-send') as HTMLButtonElement;

describe('BarcodeBroadcastCard', () => {
  it('counts only students with a usable guardian number', () => {
    renderCard([
      student('S1'),
      student('S2', { guardian_phone: '' }),
      student('S3', { is_active: false })
    ]);
    expect(screen.getByTestId('barcode-reachable').textContent).toBe('1');
    expect(screen.getByText('بلا رقم صالح')).toBeTruthy();
  });

  it('narrows the audience to the manually selected students', () => {
    renderCard([student('S1'), student('S2'), student('S3')], { selectedIds: ['S2'] });
    expect(screen.getByTestId('barcode-reachable').textContent).toBe('1');
    expect(screen.getByText('الطلاب المحددين')).toBeTruthy();
  });

  it('disables sending when nobody is reachable', () => {
    renderCard([student('S1', { guardian_phone: '' })]);
    expect(sendButton().disabled).toBe(true);
    expect(screen.getByTestId('barcode-reachable').textContent).toBe('0');
  });

  it('is disabled in simulation mode', () => {
    renderCard([student('S1')], { disabled: true });
    expect(sendButton().disabled).toBe(true);
    expect(screen.getByText('معطّل في وضع المحاكاة')).toBeTruthy();
  });

  it('asks for confirmation before sending and reports the audience', async () => {
    const { confirm } = renderCard([student('S1'), student('S2', { guardian_phone: '' })]);
    await act(async () => { fireEvent.click(sendButton()); });

    expect(confirm).toHaveBeenCalledTimes(1);
    const options = confirm.mock.calls[0][0];
    expect(options.title).toBe('إرسال الباركود لأولياء الأمور');
    expect(options.message).toContain('1 من 2');
    expect(options.message).toContain('بلا رقم واتساب صالح سيتم تخطيهم');
  });

  it('does nothing when the confirmation is declined', async () => {
    const confirm = vi.fn(async () => false);
    renderCard([student('S1')], { confirm });
    await act(async () => { fireEvent.click(sendButton()); });

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('uploads a card per student and queues them in one call', async () => {
    const { onNotify, onCompleted } = renderCard([student('S1'), student('S2')]);
    await act(async () => { fireEvent.click(sendButton()); });

    await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(1));
    expect(mocks.renderFile).toHaveBeenCalledTimes(2);
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(mocks.enqueue.mock.calls[0][0]).toMatchObject([
      { phone: '966501234567', student_name: 'طالب S1', attachment: '/uploads/barcode_S1.png' },
      { phone: '966501234567', student_name: 'طالب S2', attachment: '/uploads/barcode_S2.png' }
    ]);
    expect(onNotify).toHaveBeenCalledWith('تمت إضافة 2 باركود إلى طابور واتساب', 'success');
    expect(onCompleted).toHaveBeenCalled();
  });

  it('surfaces a gateway failure instead of claiming success', async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error('تعذر الاتصال بخادم واتساب'));
    const { onNotify } = renderCard([student('S1')]);
    await act(async () => { fireEvent.click(sendButton()); });

    await waitFor(() => expect(onNotify).toHaveBeenCalled());
    expect(onNotify).toHaveBeenCalledWith('تعذر الاتصال بخادم واتساب', 'error');
  });

  it('still queues the rest when one card cannot be rendered', async () => {
    mocks.renderFile.mockImplementationOnce(async () => { throw new Error('تعذر إنشاء صورة الباركود'); });
    const { onNotify } = renderCard([student('S1'), student('S2')]);
    await act(async () => { fireEvent.click(sendButton()); });

    await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(1));
    expect(mocks.enqueue.mock.calls[0][0]).toHaveLength(1);
    expect(onNotify).toHaveBeenCalledWith('تمت إضافة 1 باركود إلى طابور واتساب (فشل 1)', 'success');
  });
});
