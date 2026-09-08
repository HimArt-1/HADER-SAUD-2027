import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import EngineControlPanel, { describeEngineState } from '../components/whatsapp/EngineControlPanel';
import type { WhatsAppCommand, WhatsAppStatus } from '../modules/whatsapp';

afterEach(() => cleanup());

const status = (patch: Partial<WhatsAppStatus>): WhatsAppStatus => ({
  running: false,
  logs: [],
  state: 'idle',
  ...patch
});

const renderPanel = (
  value: WhatsAppStatus | null,
  overrides: Partial<React.ComponentProps<typeof EngineControlPanel>> = {}
) => {
  const onCommand = vi.fn<(command: WhatsAppCommand) => void>();
  const onContinuousChange = vi.fn();
  const onResetCounters = vi.fn();
  const utils = render(
    <EngineControlPanel
      status={value}
      serverOnline
      pendingCount={0}
      continuous={false}
      onContinuousChange={onContinuousChange}
      onCommand={onCommand}
      onResetCounters={onResetCounters}
      {...overrides}
    />
  );
  return { ...utils, onCommand, onContinuousChange, onResetCounters };
};

const button = (testId: string) => screen.getByTestId(testId) as HTMLButtonElement;

describe('EngineControlPanel — two-phase WhatsApp engine controls', () => {
  it('maps every bridge state to an Arabic label', () => {
    expect(describeEngineState(null)).toMatchObject({ state: 'idle', tone: 'idle' });
    expect(describeEngineState(status({ state: 'waiting_login' }))).toMatchObject({ label: 'بانتظار مسح رمز QR', tone: 'busy' });
    expect(describeEngineState(status({ state: 'ready' }))).toMatchObject({ label: 'جاهز للإرسال', tone: 'ready' });
    expect(describeEngineState(status({ state: 'sending' }))).toMatchObject({ tone: 'sending' });
    expect(describeEngineState(status({ state: 'weird' }))).toMatchObject({ state: 'idle' });
  });

  it('offers only "تشغيل المحرك" while the engine is stopped', () => {
    const { onCommand } = renderPanel(status({ state: 'idle' }), { pendingCount: 4 });
    expect(button('engine-start').disabled).toBe(false);
    expect(screen.queryByTestId('sending-start')).toBeNull();
    expect(screen.queryByTestId('engine-focus')).toBeNull();
    expect(button('engine-stop').disabled).toBe(true);
    fireEvent.click(button('engine-start'));
    expect(onCommand).toHaveBeenCalledWith('start');
    expect(screen.getByTestId('engine-state-pill').textContent).toContain('المحرك متوقف');
  });

  it('disables the engine start button when the local bridge is offline or in simulation mode', () => {
    renderPanel(status({ state: 'idle' }), { serverOnline: false });
    expect(button('engine-start').disabled).toBe(true);
    cleanup();
    renderPanel(status({ state: 'idle' }), { simulation: true });
    expect(button('engine-start').disabled).toBe(true);
    expect(screen.getByTestId('engine-state-message').textContent).toContain('وضع المحاكاة');
  });

  it('keeps "إبدأ الإرسال" locked until the QR code is scanned', () => {
    renderPanel(status({ running: true, state: 'waiting_login', logged_in: false, pending: 3, state_message: 'بانتظار تسجيل الدخول' }));
    expect(button('sending-start').disabled).toBe(true);
    expect(button('engine-focus').disabled).toBe(false);
    expect(button('engine-stop').disabled).toBe(false);
    expect(screen.getByTestId('engine-state-pill').textContent).toContain('بانتظار مسح رمز QR');
  });

  it('starts sending from the ready state and forwards the continuous option', () => {
    const { onCommand } = renderPanel(
      status({ running: true, state: 'ready', logged_in: true, pending: 5 }),
      { continuous: true }
    );
    const start = button('sending-start');
    expect(start.disabled).toBe(false);
    expect(start.textContent).toContain('إبدأ الإرسال');
    expect(start.textContent).toContain('5');
    fireEvent.click(start);
    expect(onCommand).toHaveBeenCalledWith({ type: 'sending:start', options: { continuous: true } });

    fireEvent.click(button('engine-focus'));
    expect(onCommand).toHaveBeenCalledWith('window:focus');
    fireEvent.click(button('engine-stop'));
    expect(onCommand).toHaveBeenCalledWith('stop');
  });

  it('blocks sending on an empty queue unless continuous mode is on', () => {
    renderPanel(status({ running: true, state: 'ready', logged_in: true, pending: 0 }));
    expect(button('sending-start').disabled).toBe(true);
    expect(screen.getByTestId('engine-state-message').textContent).toContain('الطابور فارغ');
    cleanup();
    renderPanel(status({ running: true, state: 'ready', logged_in: true, pending: 0 }), { continuous: true });
    expect(button('sending-start').disabled).toBe(false);
  });

  it('shows pause / stop controls and live progress while sending', () => {
    const { onCommand } = renderPanel(status({
      running: true,
      state: 'sending',
      logged_in: true,
      sending: true,
      pending: 2,
      progress: { current: 3, total: 5, sent: 2, failed: 1, skipped: 0, lastPhone: '9665', lastName: 'سارة' }
    }));
    expect(screen.queryByTestId('sending-start')).toBeNull();
    expect(screen.getByTestId('engine-progress').textContent).toContain('3/5');
    expect(screen.getByTestId('engine-progress').textContent).toContain('سارة');
    fireEvent.click(button('sending-pause'));
    expect(onCommand).toHaveBeenCalledWith('sending:pause');
    fireEvent.click(button('sending-stop'));
    expect(onCommand).toHaveBeenCalledWith('sending:stop');
  });

  it('offers resume while paused', () => {
    const { onCommand } = renderPanel(status({ running: true, state: 'paused', logged_in: true, sending: true, paused: true }));
    expect(screen.queryByTestId('sending-pause')).toBeNull();
    fireEvent.click(button('sending-resume'));
    expect(onCommand).toHaveBeenCalledWith('sending:resume');
    expect(screen.getByTestId('engine-state-pill').textContent).toContain('متوقف مؤقتاً');
  });

  it('locks every control while a request is in flight and toggles continuous mode', () => {
    const { onContinuousChange, onResetCounters } = renderPanel(
      status({ running: true, state: 'ready', logged_in: true, pending: 1 }),
      { busy: true }
    );
    expect(button('sending-start').disabled).toBe(true);
    expect(button('engine-focus').disabled).toBe(true);
    expect(button('engine-stop').disabled).toBe(true);
    fireEvent.click(button('continuous-toggle'));
    expect(onContinuousChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText('تصفير العدادات'));
    expect(onResetCounters).toHaveBeenCalled();
  });

  it('surfaces bridge errors in the status pill', () => {
    renderPanel(status({ state: 'error', state_message: 'فشل تهيئة المتصفح - تأكد من تثبيت Google Chrome' }));
    expect(screen.getByTestId('engine-state-pill').textContent).toContain('خطأ في المحرك');
    expect(screen.getByTestId('engine-state-message').textContent).toContain('Google Chrome');
    expect(button('engine-start').disabled).toBe(false);
  });
});
