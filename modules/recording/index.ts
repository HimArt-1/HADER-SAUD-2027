import type { RecorderInfo } from '../../types';

export type CurrentUserSource = {
  getCurrentUserId(): Promise<string | null>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const createRecorderResolver = (source: CurrentUserSource) => Object.freeze({
  async resolve(fallbackLabel = 'system'): Promise<RecorderInfo> {
    try {
      const userId = await source.getCurrentUserId();
      if (!userId) {
        return { recorded_by: null, recorded_by_label: fallbackLabel };
      }
      if (!UUID_PATTERN.test(userId)) {
        return { recorded_by: null, recorded_by_label: userId };
      }
      return { recorded_by: userId, recorded_by_label: null };
    } catch {
      return { recorded_by: null, recorded_by_label: fallbackLabel };
    }
  }
});
