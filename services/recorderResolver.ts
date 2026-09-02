import { createRecorderResolver } from '../modules/recording';
import { supabase } from './supabase';

const resolver = createRecorderResolver({
  async getCurrentUserId() {
    const { data: { user }, error } = await supabase.auth.getUser();
    return error ? null : user?.id ?? null;
  }
});

export const resolveRecorder = (fallbackLabel = 'system') =>
  resolver.resolve(fallbackLabel);
