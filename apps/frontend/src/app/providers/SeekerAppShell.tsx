import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { queryClient } from '@lib/queryClient';
import { AuthProvider } from '@context/AuthContext';
import { StayoLoadingScreen } from '@shared/ui/brand';
import { AppShell } from '@/app/layouts/AppShell';
import { DiscoverAuthProvider } from '@/app/pages/discover/DiscoverAuthContext';

/**
 * The one shared provider + shell tree for every surface reachable from the
 * app-wide bottom nav — Explore, the common Profile hub, and the Tenant
 * Dashboard (Home/Payments/Food/Room) — mounted ONCE, above both the
 * Discover/Profile and Tenant route branches in `AppRouter.tsx`.
 *
 * Previously these were two separate top-level Route branches
 * (`DiscoverProviderShell` and `TenantProviderShell`), each instantiating
 * its own `QueryClientProvider`/`AuthProvider`/`AppShell`. Crossing between
 * them (e.g. Profile → Room) fully unmounted one subtree and mounted the
 * other from scratch — a brand-new `AuthProvider` instance starts at
 * `loading: true` and re-fetches `GET /auth/me`, and `ProtectedTenantRoute`
 * showed a full-screen `StayoLoadingScreen` every time while that resolved.
 * With one shared `AuthProvider` instance, `ProtectedTenantRoute` (still
 * unchanged, still the only thing that can let you into `/tenant/*`) reads
 * session state that's already resolved by the time you're navigating
 * in-app, so crossing between these areas is a normal nested-route swap.
 *
 * There is deliberately **no route guard here** — Explore stays public,
 * matching `DiscoverProviderShell`'s original contract; `ProtectedTenantRoute`
 * still gates `/tenant/*` specifically, one level deeper (see
 * `TenantProviderShell`).
 *
 * Owner and Admin keep their own separate provider trees
 * (`ProtectedAppProviders`, used by `OwnerProviderShell`/`AdminProviderShell`)
 * — different personas with different session shapes, deliberately untouched
 * by this change.
 */
export function SeekerAppShell() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DiscoverAuthProvider>
          <AppShell>
            <Suspense fallback={<StayoLoadingScreen />}>
              <Outlet />
            </Suspense>
          </AppShell>
        </DiscoverAuthProvider>
        <Toaster position="top-right" expand visibleToasts={4} closeButton richColors />
      </AuthProvider>
    </QueryClientProvider>
  );
}
