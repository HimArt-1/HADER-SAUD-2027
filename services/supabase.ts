import { createClient } from '@supabase/supabase-js';

type SupabaseFallbackResponse = Promise<{ data: null; error: Error; count?: null }>; // Minimal shape to satisfy callers

const createFallbackResponse = (message: string): SupabaseFallbackResponse =>
  Promise.resolve({ data: null, error: new Error(message), count: null });

const createFallbackTable = () => {
  const baseResponse = () => createFallbackResponse('Supabase client not configured');
  const response = baseResponse();
  const chain: any = Object.assign(response, {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    upsert: () => chain,
    order: () => chain,
    range: () => chain,
    eq: () => chain,
    single: () => response,
    maybeSingle: () => response
  });
  return chain;
};

const createFallbackStorage = () => ({
  upload: () => createFallbackResponse('Supabase storage not configured') as any,
  download: () => createFallbackResponse('Supabase storage not configured') as any,
  remove: () => createFallbackResponse('Supabase storage not configured') as any,
  getPublicUrl: () => ({ data: { publicUrl: '' } })
});

const createFallbackRealtimeChannel = () => {
  const channel: any = {
    on: () => channel,
    subscribe: (callback?: (status: string) => void) => {
      callback?.('CLOSED');
      return channel;
    },
    unsubscribe: () => Promise.resolve('ok')
  };
  return channel;
};

const createFallbackClient = () => ({
  from: () => createFallbackTable(),
  rpc: () => createFallbackResponse('Supabase client not configured'),
  storage: {
    from: () => createFallbackStorage(),
    listBuckets: () => createFallbackResponse('Supabase storage not configured'),
    createBucket: () => createFallbackResponse('Supabase storage not configured')
  },
  channel: () => createFallbackRealtimeChannel(),
  removeChannel: () => Promise.resolve('ok')
});

const shouldDebugSupabase = () => {
  try {
    return import.meta.env.DEV && localStorage.getItem('hader:debug') === 'true';
  } catch {
    return false;
  }
};

// Load Supabase credentials from environment variables
// In production (Vercel), these are set via environment variables
// In development, set them in .env.local
const supabaseUrl = import.meta?.env?.VITE_SUPABASE_URL;
const supabaseKey = import.meta?.env?.VITE_SUPABASE_ANON_KEY;

export const supabaseStatus = {
  isConfigured: Boolean(supabaseUrl && supabaseKey)
};

// Initialize Supabase client or safe fallback
export const supabase: any = supabaseStatus.isConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : createFallbackClient();

export const revokeSurveySessionKeepalive = async (sessionToken: string): Promise<void> => {
  if (!supabaseUrl || !supabaseKey || !sessionToken) return;
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/revoke_hader_survey_admin_session`, {
    method: 'POST',
    keepalive: true,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_session_token: sessionToken })
  });
  if (!response.ok) throw new Error(`Survey session revocation failed (${response.status})`);
};

// Debug function to verify Supabase connection
export function getSupabaseDebugInfo() {
  return {
    url: supabaseUrl,
    keyPrefix: supabaseKey ? `${supabaseKey.substring(0, 10)}***` : 'N/A', // Partial key for security
    isConfigured: supabaseStatus.isConfigured,
    timestamp: new Date().toISOString(),
    usingFallback: !supabaseStatus.isConfigured
  };
}

// Log Supabase initialization or fallback
if (supabaseStatus.isConfigured) {
  if (shouldDebugSupabase()) {
    console.log('🔗 Supabase Client Initialized');
    console.log(`   URL: ${supabaseUrl}`);
    console.log(`   Key: ${supabaseKey?.substring(0, 10)}***`);
  }
} else {
  if (shouldDebugSupabase()) {
    console.warn('⚠️ Supabase environment variables are missing. Running with fallback client for local/testing.');
  }
}

export const handleSupabaseError = (error: any, context: string) => {
  console.error(`[Supabase Error] ${context}:`, error);
  return error;
};

export const logError = (error: any, context: string) => {
  console.error(`[Error] ${context}:`, error);
};
