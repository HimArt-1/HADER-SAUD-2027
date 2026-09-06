import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { KioskStatus } from '../services/kioskPresenceService';

const presence = vi.hoisted(() => ({ listenForPresence: vi.fn() }));
vi.mock('../services/kioskPresenceService', () => ({ kioskPresenceService: presence }));
import SupportKioskDiagnostics from '../components/SupportKioskDiagnostics';
afterEach(cleanup);

describe('support kiosk diagnostics', () => {
  it('waits for real presence, updates on loss of contact and unsubscribes', () => {
    let receive: (kiosks: KioskStatus[]) => void = () => {};
    const unsubscribe = vi.fn();
    presence.listenForPresence.mockImplementation(callback => { receive = callback; return unsubscribe; });
    const view = render(<SupportKioskDiagnostics />);
    expect(screen.queryByText('متصل')).toBeNull();
    expect(screen.getByText(/لم تصل إشارة/)).toBeTruthy();
    const kiosk: KioskStatus = { kioskId: 'kiosk-1', kioskName: 'كشك المدرسة', lastSeen: Date.now(), status: 'online', cameraReady: true, syncPending: 3 };
    act(() => receive([kiosk]));
    expect(screen.getByText('متصل')).toBeTruthy();
    expect(screen.getByText('عناصر تنتظر المزامنة: 3')).toBeTruthy();
    act(() => receive([{ ...kiosk, status: 'offline' }]));
    expect(screen.getByText('غير متصل')).toBeTruthy();
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
