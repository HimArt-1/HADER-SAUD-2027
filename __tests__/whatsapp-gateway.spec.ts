import { describe, expect, it, vi } from 'vitest';
import { createInMemoryWhatsAppGateway, isEngineAlive } from '../modules/whatsapp';
import {
  createHttpWhatsAppGateway,
  WHATSAPP_COMMAND_ROUTES,
  WhatsAppGatewayError
} from '../services/whatsappGateway';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

describe('WhatsApp gateway interface', () => {
  it('supports deterministic queue and control behavior through the in-memory adapter', async () => {
    const gateway = createInMemoryWhatsAppGateway();
    const queueUpdates: Array<{ action: string; added: number }> = [];
    const unsubscribe = gateway.subscribe({ onQueueUpdate: update => queueUpdates.push(update) });

    await gateway.enqueue([
      { phone: '0500000000', message: 'Hello', student_name: 'Student' }
    ]);
    expect(await gateway.getQueue()).toMatchObject([
      { phone: '0500000000', message: 'Hello', studentName: 'Student', status: 'pending' }
    ]);
    expect(queueUpdates).toEqual([{ action: 'send', added: 1 }]);

    await gateway.control('start');
    expect((await gateway.getStatus()).running).toBe(true);
    await gateway.control('clear');
    expect(await gateway.getQueue()).toEqual([]);
    unsubscribe();
  });

  it('mirrors the two-phase engine flow in the in-memory adapter', async () => {
    const gateway = createInMemoryWhatsAppGateway({ requireQrScan: true });
    await gateway.enqueue([{ phone: '0500000001', message: 'A' }, { phone: '0500000002', message: 'B' }]);

    // "تشغيل المحرك" opens WhatsApp Web and parks in waiting_login — nothing is sent.
    await gateway.control('start');
    let status = await gateway.getStatus();
    expect(status).toMatchObject({ running: true, state: 'waiting_login', logged_in: false, pending: 2 });
    expect(isEngineAlive(status)).toBe(true);
    await expect(gateway.control('sending:start')).rejects.toThrow('QR');
    expect((await gateway.getQueue()).every(item => item.status === 'pending')).toBe(true);

    // Once logged in, "إبدأ الإرسال" dispatches the queue and returns to ready.
    await gateway.control('stop');
    expect((await gateway.getStatus()).running).toBe(false);
    const loggedIn = createInMemoryWhatsAppGateway({
      queue: [{ phone: '0500000001', message: 'A' }]
    });
    await loggedIn.control('start');
    expect(await loggedIn.getStatus()).toMatchObject({ state: 'ready', logged_in: true, pending: 1 });
    await loggedIn.control({ type: 'sending:start', options: { continuous: false } });
    status = await loggedIn.getStatus();
    expect(status).toMatchObject({ state: 'ready', sending: false, pending: 0 });
    expect(status.progress).toMatchObject({ sent: 1, total: 1 });
    expect((await loggedIn.getQueue())[0].status).toBe('sent');
    await expect(loggedIn.control('sending:pause')).rejects.toThrow();
    await expect(createInMemoryWhatsAppGateway().control('window:focus')).rejects.toThrow('شغّل المحرك');
  });

  it('centralizes API paths, authentication, payloads and queue normalization', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/api/status')) {
        return jsonResponse({
          running: true,
          version: '3.0.0',
          state: 'sending',
          state_message: 'جاري الإرسال 2/5 → أحمد',
          logged_in: true,
          sending: true,
          paused: false,
          pending: 3,
          progress: { current: 2, total: 5, sent: 1, failed: 1, skipped: 0, last_phone: '9665', last_name: 'أحمد' },
          logs: ['10:00:00 🚀 Mission start']
        });
      }
      if (url.endsWith('/api/queue')) {
        return jsonResponse([
          { id: 'sent', phone: '3', message: 'done', status: 'sent', timestamp: 20 },
          { phone: '1', message: 'first pending', status: 'pending', timestamp: 1, student_name: 'A' },
          { id: 'sending', phone: '2', message: 'active', status: 'sending', timestamp: 5 }
        ]);
      }
      if (url.endsWith('/api/upload')) return jsonResponse({ path: '/uploads/badge.png' });
      return jsonResponse({ message: 'ok' });
    });
    const gateway = createHttpWhatsAppGateway({
      baseUrl: 'http://localhost:5001/',
      apiKey: 'secret-key',
      fetcher
    });

    expect(await gateway.getStatus()).toMatchObject({
      running: true,
      version: '3.0.0',
      state: 'sending',
      logged_in: true,
      sending: true,
      paused: false,
      pending: 3,
      progress: { current: 2, total: 5, sent: 1, failed: 1, skipped: 0, lastPhone: '9665', lastName: 'أحمد' },
      logs: ['10:00:00 🚀 Mission start']
    });
    const queue = await gateway.getQueue();
    expect(queue.map(item => item.status)).toEqual([
      'sending',
      'pending',
      'sent'
    ]);
    expect(queue[1]).toMatchObject({
      id: 'msg_1_1_firstpend',
      studentName: 'A'
    });
    await gateway.enqueue([{ phone: '0500', message: 'مرحباً' }]);
    await gateway.control('start');
    await gateway.control('clear');
    expect(await gateway.upload(new File(['image'], 'badge.png', { type: 'image/png' })))
      .toBe('/uploads/badge.png');
    await gateway.control('sending:start');
    await gateway.control('sending:pause');
    await gateway.control('sending:resume');
    await gateway.control('sending:stop');
    await gateway.control('window:focus');
    await gateway.control({ type: 'sending:start', options: { continuous: true, batchSize: 4, minDelay: 5 } });
    await gateway.control({ type: 'start', autoSend: true });

    expect(requests.map(request => request.url)).toEqual([
      'http://localhost:5001/api/status',
      'http://localhost:5001/api/queue',
      'http://localhost:5001/api/send?append=true',
      'http://localhost:5001/api/start',
      'http://localhost:5001/api/clear',
      'http://localhost:5001/api/upload',
      'http://localhost:5001/api/sending/start',
      'http://localhost:5001/api/sending/pause',
      'http://localhost:5001/api/sending/resume',
      'http://localhost:5001/api/sending/stop',
      'http://localhost:5001/api/window/focus',
      'http://localhost:5001/api/sending/start',
      'http://localhost:5001/api/start'
    ]);
    for (const request of requests) {
      expect(request.init?.headers).toMatchObject({ 'X-API-Key': 'secret-key' });
    }
    expect(requests[2].init).toMatchObject({ method: 'POST' });
    expect(requests[2].init?.body).toBe(JSON.stringify([{ phone: '0500', message: 'مرحباً' }]));
    expect(requests[5].init?.body).toBeInstanceOf(FormData);
    expect(requests[5].init?.headers).not.toHaveProperty('Content-Type');
    for (const index of [6, 7, 8, 9, 10]) expect(requests[index].init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(requests[11].init?.body))).toEqual({
      options: { continuous: true, batch_size: 4, min_delay: 5 }
    });
    expect(JSON.parse(String(requests[12].init?.body))).toEqual({ auto_send: true, options: {} });
    expect(Object.values(WHATSAPP_COMMAND_ROUTES).every(route => route.startsWith('/api/'))).toBe(true);
  });

  it('surfaces the bridge message when a control command is rejected', async () => {
    const gateway = createHttpWhatsAppGateway({
      fetcher: async () => jsonResponse({ message: 'امسح رمز QR في نافذة واتساب ويب أولاً', ok: false, state: 'waiting_login' }, 409)
    });
    await expect(gateway.control('sending:start')).rejects.toEqual(
      expect.objectContaining({ message: 'امسح رمز QR في نافذة واتساب ويب أولاً', status: 409 })
    );
  });

  it('falls back to the legacy delete route and exposes useful server errors', async () => {
    const urls: string[] = [];
    const gateway = createHttpWhatsAppGateway({
      fetcher: async input => {
        const url = String(input);
        urls.push(url);
        if (url.includes('/api/queue/')) return new Response('Not Found', { status: 404 });
        if (url.includes('/api/delete/')) return jsonResponse({ message: 'تم الحذف' });
        return jsonResponse({ error: 'مفتاح غير صالح' }, 401);
      }
    });

    await gateway.control({ type: 'remove', id: 'item/1' });
    expect(urls.slice(0, 2)).toEqual([
      'http://localhost:5001/api/queue/item%2F1',
      'http://localhost:5001/api/delete/item%2F1'
    ]);

    await expect(gateway.getStatus()).rejects.toEqual(
      expect.objectContaining<Partial<WhatsAppGatewayError>>({
        name: 'WhatsAppGatewayError',
        message: 'مفتاح غير صالح',
        status: 401
      })
    );
  });

  it('parses authenticated SSE status and queue events through the same interface', async () => {
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(encoder.encode(
          'event: status\ndata: {"running":true,"state":"running"}\n\n' +
          'event: queue_update\ndata: {"action":"send","added":2}\n\n'
        ));
      }
    });
    const fetcher = vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    }));
    const gateway = createHttpWhatsAppGateway({ apiKey: 'stream-key', fetcher });

    const received = await new Promise<{ running: boolean; added: number }>((resolve, reject) => {
      let running = false;
      let added = 0;
      const timeout = setTimeout(() => reject(new Error('SSE test timed out')), 1_000);
      const unsubscribe = gateway.subscribe({
        onStatus: status => {
          running = status.running;
          if (added) {
            clearTimeout(timeout);
            unsubscribe();
            resolve({ running, added });
          }
        },
        onQueueUpdate: update => {
          added = update.added;
          if (running) {
            clearTimeout(timeout);
            unsubscribe();
            resolve({ running, added });
          }
        },
        onError: reject
      });
    });

    expect(received).toEqual({ running: true, added: 2 });
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:5001/api/events',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-API-Key': 'stream-key' })
      })
    );
    streamController?.close();
  });
});
