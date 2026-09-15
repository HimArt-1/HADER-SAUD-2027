import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import QueueVisualizer from '../components/whatsapp/QueueVisualizer';
import SendingProgress from '../components/whatsapp/SendingProgress';
import type { WhatsAppQueueStatus } from '../modules/whatsapp';

afterEach(() => cleanup());

const item = (id: string, status: WhatsAppQueueStatus) => ({
  id,
  studentName: `طالب ${id}`,
  status,
  timestamp: 0
});

describe('WhatsApp queue — rows the bridge finished without a clean send', () => {
  it('labels unconfirmed, unreachable and skipped rows instead of showing them as waiting', () => {
    render(
      <QueueVisualizer
        queue={[item('u', 'unconfirmed'), item('i', 'invalid_phone'), item('s', 'skipped'), item('p', 'pending')]}
      />
    );

    expect(screen.getByText('بحاجة مراجعة')).toBeTruthy();
    expect(screen.getByText('رقم غير موجود على واتساب')).toBeTruthy();
    expect(screen.getByText('متخطاة')).toBeTruthy();
    expect(screen.getByTitle('في الانتظار')).toBeTruthy();
  });

  it('counts settled rows as progress and keeps skipped rows out of the success rate', () => {
    render(
      <SendingProgress
        queue={[item('a', 'sent'), item('b', 'unconfirmed'), item('c', 'invalid_phone'), item('d', 'pending')]}
      />
    );

    expect(screen.getByText('75%')).toBeTruthy();                       // 3 of 4 rows are settled
    expect(screen.getByText('50%')).toBeTruthy();                       // 1 sent of 2 that reached WhatsApp
    expect(screen.getByText(/بحاجة مراجعة 1/)).toBeTruthy();
    expect(screen.getByText(/متخطاة أو بلا واتساب 1/)).toBeTruthy();
    expect(screen.getByTitle('رسالة 2: بحاجة مراجعة')).toBeTruthy();
  });
});
