import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Role, User } from '../types';

const mocks = vi.hoisted(() => ({ loadMorningBriefing: vi.fn(), speak: vi.fn() }));
vi.mock('../services/ustadHader/morningBriefing', () => ({ loadMorningBriefing: mocks.loadMorningBriefing }));
vi.mock('../services/ustadHader/speechService', () => ({ ustadSpeech: { speak: mocks.speak } }));

import UstadBriefingBanner, { USTAD_BRIEFING_AUTO_KEY } from '../components/ustadHader/UstadBriefingBanner';

const user: User = { id: 'u-admin', username: 'admin', name: 'مدير النظام', role: Role.SITE_ADMIN };

const ready = {
  status: 'ready',
  date: '2026-09-15',
  total: 4,
  present: 1,
  late: 1,
  absent: 2,
  attended: 2,
  rate: 50,
  repeatedAbsentees: [{ id: 's2', name: 'خالد سعد الشهري', classLabel: 'الثالث - ب', streak: 2, recentAbsences: 2 }],
  repeatedCount: 1,
  spokenText: 'صباح الخير. حضر اليوم 2 من 4.'
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('UstadBriefingBanner', () => {
  it('shows the day summary and speaks it only on request', async () => {
    mocks.loadMorningBriefing.mockResolvedValue(ready);
    render(<UstadBriefingBanner user={user} onOpenDetails={vi.fn()} />);

    expect(await screen.findByText('ملخص اليوم من أستاذ حاضر')).toBeTruthy();
    expect(screen.getByText(/خالد سعد الشهري/)).toBeTruthy();
    expect(mocks.speak).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /اسمع الملخص/ }));
    expect(mocks.speak).toHaveBeenCalledWith(ready.spokenText);
  });

  it('appears once per day for each user', async () => {
    mocks.loadMorningBriefing.mockResolvedValue(ready);
    const { unmount } = render(<UstadBriefingBanner user={user} onOpenDetails={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'إخفاء ملخص اليوم' }));
    unmount();

    render(<UstadBriefingBanner user={user} onOpenDetails={vi.fn()} />);
    await waitFor(() => expect(mocks.loadMorningBriefing).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('ملخص اليوم من أستاذ حاضر')).toBeNull();
  });

  it('opens the assistant for details', async () => {
    mocks.loadMorningBriefing.mockResolvedValue(ready);
    const onOpenDetails = vi.fn();
    render(<UstadBriefingBanner user={user} onOpenDetails={onOpenDetails} />);

    fireEvent.click(await screen.findByRole('button', { name: /التفاصيل/ }));
    expect(onOpenDetails).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('ملخص اليوم من أستاذ حاضر')).toBeNull();
  });

  it('appears by itself when the morning grace period ends', async () => {
    mocks.loadMorningBriefing
      .mockResolvedValueOnce({ status: 'pending', date: '2026-09-15', readyAt: Date.now() + 10, readyLabel: '07:00', spokenText: '' })
      .mockResolvedValueOnce(ready);
    render(<UstadBriefingBanner user={user} onOpenDetails={vi.fn()} />);

    expect(await screen.findByText('ملخص اليوم من أستاذ حاضر', {}, { timeout: 2500 })).toBeTruthy();
    expect(mocks.loadMorningBriefing).toHaveBeenCalledTimes(2);
  });

  it('stays hidden after the user turns off automatic briefings', async () => {
    mocks.loadMorningBriefing.mockResolvedValue(ready);
    const { unmount } = render(<UstadBriefingBanner user={user} onOpenDetails={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'لا تعرضه تلقائياً' }));
    expect(localStorage.getItem(USTAD_BRIEFING_AUTO_KEY)).toBe('off');
    unmount();

    render(<UstadBriefingBanner user={user} onOpenDetails={vi.fn()} />);
    expect(mocks.loadMorningBriefing).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for accounts without attendance access', async () => {
    mocks.loadMorningBriefing.mockResolvedValue(null);
    const { container } = render(<UstadBriefingBanner user={user} onOpenDetails={vi.fn()} />);
    await waitFor(() => expect(mocks.loadMorningBriefing).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });
});
