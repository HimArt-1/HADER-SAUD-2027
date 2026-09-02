/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_APP_MODE?: string;
  readonly VITE_ALLOW_LOCAL_FALLBACK?: string;
  readonly VITE_APP_URL?: string;
  readonly VITE_ENABLE_TELEMETRY?: string;
  readonly VITE_ENABLE_DEBUG?: string;
  readonly VITE_ENABLE_PWA?: string;
  readonly VITE_DESKTOP_RELEASE_URL?: string;
  readonly MODE: string;
  readonly TEST?: boolean;
  readonly VITEST?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

