/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://abcd1234.supabase.co (enables cloud sync). */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon / publishable key. Public by design — Row Level Security protects data. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}
