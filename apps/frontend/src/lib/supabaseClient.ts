import { createClient } from '@supabase/supabase-js';

// Supabase Auth migration (ADR-031) — the sole authentication provider.
// A true module-level singleton is required: this app mounts <AuthProvider>
// at 3+ separate route-tree roots (OwnerProviderShell/TenantProviderShell/
// AdminProviderShell/the public shell), and multiple GoTrueClient instances
// in one browser tab fight over localStorage and refresh timers.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (typeof supabaseUrl !== 'string' || !supabaseUrl.trim() || typeof supabaseAnonKey !== 'string' || !supabaseAnonKey.trim()) {
  throw new Error(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. StayO requires explicit Supabase ' +
      'config in every environment (development, staging, production) — see apps/frontend/.env.example.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});
