import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { ProtectedTenantRoute } from '@/app/components/ProtectedTenantRoute';

/**
 * Page-level loading skeleton only — not the full-screen branding/loading
 * screen. `QueryClientProvider`/`AuthProvider`/`AppShell` now live once,
 * shared with Explore/Profile, above this in `SeekerAppShell`
 * (`app/providers/SeekerAppShell.tsx`) — this component is just
 * `ProtectedTenantRoute`'s tenancy-liveness gate plus a lightweight
 * placeholder while an individual tenant page's own lazy chunk loads.
 */
function TenantRouteFallback() {
  return (
    <div className="min-h-screen bg-background px-4 py-5">
      <div className="space-y-4">
        <div className="h-28 rounded-2xl bg-muted animate-pulse" />
        <div className="h-16 rounded-xl bg-muted animate-pulse" />
        <div className="h-36 rounded-xl bg-muted animate-pulse" />
      </div>
    </div>
  );
}

export function TenantProviderShell() {
  return (
    <ProtectedTenantRoute>
      <Suspense fallback={<TenantRouteFallback />}>
        <Outlet />
      </Suspense>
    </ProtectedTenantRoute>
  );
}
