import { describe, expect, it } from 'vitest';
import { createRecorderResolver } from '../modules/recording';

describe('recorder resolver interface', () => {
  it('uses a valid authenticated UUID as the foreign key', async () => {
    const resolver = createRecorderResolver({
      getCurrentUserId: async () => 'c97161eb-c1f1-462f-b9a5-631b4d6d8f91'
    });

    await expect(resolver.resolve('kiosk')).resolves.toEqual({
      recorded_by: 'c97161eb-c1f1-462f-b9a5-631b4d6d8f91',
      recorded_by_label: null
    });
  });

  it('keeps a non-UUID local identity in the label column', async () => {
    const resolver = createRecorderResolver({
      getCurrentUserId: async () => 'adminhim-local'
    });

    await expect(resolver.resolve('fallback')).resolves.toEqual({
      recorded_by: null,
      recorded_by_label: 'adminhim-local'
    });
  });

  it('uses the fallback label when authentication is absent or unavailable', async () => {
    const absent = createRecorderResolver({ getCurrentUserId: async () => null });
    const unavailable = createRecorderResolver({
      getCurrentUserId: async () => { throw new Error('offline'); }
    });

    await expect(absent.resolve('admin-manual')).resolves.toEqual({
      recorded_by: null,
      recorded_by_label: 'admin-manual'
    });
    await expect(unavailable.resolve('admin-manual')).resolves.toEqual({
      recorded_by: null,
      recorded_by_label: 'admin-manual'
    });
  });
});
